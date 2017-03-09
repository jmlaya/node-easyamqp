import fs from 'fs';
import amqp from 'amqplib';
import yaml from "js-yaml";
import colors from 'colors';

import node_package from '../package.json';

const CONST = {
  DEFAULT_ENVIRONMENT: 'default',
  DEFAULT_PORT: 1337
};

export default class {

  constructor(options = `/easyamqp.yml`) {

    __handleProcess.bind(this);

    this.config = options;

    if (typeof options === 'string') {
      this.config = __loadConfig(options);
    }
  }

  listenQueues() {

    const cnnStr = __getConnectionString(this.config);

    if (!this.config.queues) {
      return __errorMessage('Does not exists queues to bind, please review your config file'.grey);
    }

    if (!this.config.tasks) {
      return __errorMessage('Does not exists tasks to bind, please review your config file'.grey);
    }

    __sendInitialMessage(this.config);

    this.config.tasks = __loadTasks(this.config.tasks);

    amqp.connect(cnnStr)
      .then(_createChannel)
      .then(_assertQueues(this.config))
      .catch(err => {
        __errorMessage(err, true);
      });
  }

  sendToExchange(exchange, routingKey, data, options) {
    _sendMessage.bind(this)(null, exchange, routingKey, data, options);
  }

  sendToQuque(queue, data, options) {
    _sendMessage.bind(this)(queue, null, null, data, options);
  }

}

function __sendInitialMessage(config) {
  process.stdout.write("\u001B[2J\u001B[0;0f");
  console.log("=".repeat(72));
  console.log(` Easy AMQP consumer service v${node_package.version}`);
  console.log(" https://github.com/jmlaya/node-easyamqp".grey);
  console.log("=".repeat(72));
  console.log(" ▣ ENVIRONMENT");
  __okMessage("Environment".grey, config.type);
  __okMessage("Connection".grey, `amqp://${config.user}:??PASS??@${config.host}:${config.port}/${config.vhost}`);
  __okMessage("Timezone".grey, config.timezone);
  console.log("-".repeat(72));
}

function __loadConfig(fileName) {
  let file = `${process.cwd()}${fileName}`;

  try {
    const config = yaml.safeLoad(fs.readFileSync(file, "utf8"));
    const environment = __loadEnvironmentFile(config && config.environment || null) || {};

    return Object.keys(config).reduce((prev, curr) => {
      if (typeof config[curr] === 'object' && !Array.isArray(config[curr])) {
        prev[curr] = Object.assign({}, config[curr], environment[curr] || {});
      } else {
        prev[curr] = environment[curr] || config[curr];
      }
      return prev;
    }, {});
  } catch (err) {
    __errorMessage(`AMQP config file "${fileName}" could not be loaded`.grey);
    __errorMessage(err, true);
  }
}

function __loadEnvironmentFile(environment) {
  let envName = process.env.NODE_ENV || environment || CONST.DEFAULT_ENVIRONMENT;

  try {
    if (envName !== CONST.DEFAULT_ENVIRONMENT) {
      const file = `${process.cwd()}/environment/easyamqp.${envName}.yml`;
      
      return Object.assign(
        yaml.safeLoad(fs.readFileSync(file, "utf8")) || {}, { type: envName }
      );
    }
  } catch (err) {
    __errorMessage(`Environment "${envName}" could not be loaded`.grey);
    __errorMessage(err, true);
  }
}

function __loadTasks(path) {

  function filter(file) {
    return (file.indexOf('.') !== 0) && (file.slice(-3) === '.js');
  }

  function reduce(prev, curr) {
    const module = require(`${process.cwd()}${path}/${curr}`);
    prev[curr.split('.')[0]] = module.default || module;
    return prev;
  }

  return fs.readdirSync(`${process.cwd()}${path}`).filter(filter).reduce(reduce, {});
}

function __getConnectionString(config) {
  const vhost = (config.vhost && config.vhost !== "/") ? config.vhost : '';
  return `amqp://${config.user}:${config.pass}@${config.host}:${config.port}/${vhost}`;
}

function __handleProcess() {

  process.on("uncaughtException", error => {
    __logUncaughtError(error);
    process.exit(1);
  });

  ["SIGTERM", "SIGINT"].map((event) =>
    process.on(event, () => {
      //__closeServer();
      process.exit(0);
    }));
}

function __errorMessage() {
  var values = arguments;
  values = Object.keys(values).map(key => values[key]);

  console.log(" ⚑".red, values.filter(value => typeof value !== 'boolean').join(' '));
  if (values.pop() === true) {
    process.exit(1);
  }
}

function __okMessage() {
  var values = arguments;
  console.log(" ✓".green, Object.keys(values).map(function(key) { return values[key]; }).join(' '));
}


function __br(heading, hr = true) {
  if (hr) {
    console.log("-".repeat(72).grey);
  }
  if (heading) {
    console.log(` ▣ ${heading}`);
  }
}

function __logUncaughtError(error) {
  console.log(" ⚑ [uncaughtException]".red, new Date().toString().grey,
    `\n   ${error.message}`.red,
    "\n  ", error.stack);
  let file_name = `${process.cwd()}/zen.error.json`;
  error = {
    date: new Date(),
    stack: error.stack
  };
  fs.writeFileSync(file_name, JSON.stringify(error, null, 0), "utf8");
}

function _createChannel(connection) {
  return connection.createChannel();
}

function _assertQueues(config) {

  return channel => {
    __br('BINDING QUEUES', false);
    const promises = [];
    config.queues.forEach(queue => {
      promises.push(new Promise((res, rej) => {
        channel.assertQueue(queue.name).then(q => {
          res({ q: q, queue: queue });
        }).catch(rej);
      }));
    });

    Promise.all(promises).then(values => {
      values.forEach(value => {
        let { q, queue } = value;
        q.config = queue;
        _createQueueBindings(q, channel);
        _consumeMessages(q, channel, config.tasks);
      });
      __br('MESSAGES');
    }).catch(reason => {
      __errorMessage(reason, true);
    });
  };
}

function _createQueueBindings(queue, channel) {
  if (queue.config.bindings) {
    queue.config.bindings.forEach(binding => {
      channel.assertExchange(binding.exchange, 'direct', { durable: true });
      channel.bindQueue(queue.queue, binding.exchange, binding['routing-key']);
    });
  }
}

function _consumeMessages(queue, channel, tasks, binding) {

  const self = this;
  let handled = false;

  if (queue.config.bindings) {
    queue.config.bindings.forEach(binding => {
      if (binding.task) {
        handled = !handled ? true : handled;
        __okMessage(`Listening from ${queue.config.name} using ${binding.exchange}[${binding['routing-key']}]`.grey);
      } else {
        __errorMessage(`The binding ${binding.exchange}[${binding['routing-key']}] => ${queue.config.name} isn't handled by any task`);
      }
    });
  }

  if (queue.config.task) {
    handled = true;
    __okMessage(`Listening direct messages from ${queue.config.name}`.grey);
  }

  if (!handled) {
    __errorMessage(`The queue -${queue.config.name}- isn't handled by any task`.red, true);
  }

  channel.consume(queue.config.name, msg => {
    if (msg.fields && msg.fields.routingKey && msg.content) {

      let binding = queue.config.bindings.filter(binding => binding['routing-key'] === msg.fields.routingKey).pop();
      let data = JSON.parse(msg.content);

      if (msg.fields.routingKey === queue.config.name && queue.config.task) {
        __okMessage(`Direct message to ${queue.config.name} handled by ${queue.config.task}() task`.grey);
        tasks[queue.config.task](data);
      }

      if (binding && binding.task) {
        __okMessage(`Routed message from ${msg.fields.exchange}[${msg.fields.routingKey}] to ${queue.config.name} handled by ${binding.task}() task`.grey);
        tasks[binding.task](data);
      }

    }

  }, { noAck: true });
}

function _sendMessage(queue, exchange, routingKey, data, options = {}) {

  const cnnStr = __getConnectionString(this.config);

  amqp.connect(cnnStr)
    .then(_createChannel)
    .then(channel => {
      channel.assertExchange(exchange, 'direct', { durable: true });

      const content = new Buffer(JSON.stringify(data));

      if (queue) {
        channel.sendToQueue(queue, content, options);
      } else {
        channel.publish(exchange, routingKey, content, options);
      }

      setTimeout(function() {
        channel.connection.close();
      }, 500);
    });
}
