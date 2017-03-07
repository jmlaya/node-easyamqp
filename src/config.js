import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import colors from "colors";

const CONST = {
  DEFAULT_ENVIRONMENT: 'default',
  DEFAULT_PORT: 1337
};

function loadServerFile() {

  let fileName = `${process.argv[2] || 'fluent'}.yml`,
    file = path.join(process.cwd(), `/${fileName}`);

  try {
    return yaml.safeLoad(fs.readFileSync(file, "utf8"));
  } catch (err) {
    console.log(" x".red, `Fuent file "${fileName}" could not be loaded`.grey);
    console.log("  ", err.message.red);
    process.exit();
  }
}

function loadEnvironmentFile(environment) {
  let envName = process.argv[3] || environment || CONST.DEFAULT_ENVIRONMENT;

  try {
    if (envName !== CONST.DEFAULT_ENVIRONMENT) {
      let file = path.join(process.cwd(), `/environment/${envName}.yml`);

      return Object.assign(
        yaml.safeLoad(fs.readFileSync(file, "utf8")) || {},
        { type: envName}
      );
    }
  } catch (err) {
    console.log(" x".red, `Environment "${envName}" could not be loaded`.grey);
    console.log("  ", err.message.red);
    process.exit();
  }
}

function __processHeaders(config){
  return Object.keys(config.headers)
    .map(key => {
      var value = config.headers[key];
      return {
        key: key,
        value: Array.isArray(value) ? value.join(", ") : value
      };
    })
    .reduce((prev, curr) => {
      prev[curr.key] = curr.value;
      return prev;
    }, {});
}

export default (function() {

  //-- Fluent config file ---------------------------------------------------------
  let FluentConfig = loadServerFile();

  // -- Fluent environment (if exists) ---------------------------------------------
  FluentConfig = Object.assign({}, FluentConfig, loadEnvironmentFile(FluentConfig.environment));

  // -- Fluent port ----------------------------------------------------------------
  FluentConfig.port = process.argv[4] || FluentConfig.port || process.env.PORT || CONST.DEFAULT_PORT;

  // -- Fluent headers for cors ----------------------------------------------------
  if(FluentConfig.headers){
    FluentConfig.headers = __processHeaders(FluentConfig);
  }

  // -- Fluent timezone ------------------------------------------------------------
  if (FluentConfig.timezone) { process.env.TZ = FluentConfig.timezone; }

  // -- Fluent constants & path ----------------------------------------------------
  FluentConfig.path = FluentConfig && FluentConfig.path;
  FluentConfig.CONST = CONST;

  return FluentConfig;

})();
