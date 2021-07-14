const path = require('path')
const webpack = require('webpack')
const nodeExternals = require('webpack-node-externals')
var WebpackObfuscator = require('webpack-obfuscator');
const externalsFunc = nodeExternals();
//const IgnoreDynamicRequire = require('webpack-ignore-dynamic-require');

class IgnoreDynamicRequire {
  apply (compiler) {
    compiler.hooks.normalModuleFactory.tap('IgnoreDynamicRequire', factory => {
      factory.hooks.parser.for('javascript/auto').tap('IgnoreDynamicRequire', (parser, options) => {
        parser.hooks.call.for('require').tap('IgnoreDynamicRequire', expression => {
          // This is a SyncBailHook, so returning anything stops the parser, and nothing allows to continue
          if (expression.arguments.length !== 1 || expression.arguments[0].type === 'Literal') {
            return
          }
          const arg = parser.evaluateExpression(expression.arguments[0])
          if (!arg.isString() && !arg.isConditional()) {
              /*if (arg.prefix && arg.prefix.string == "./platform_") {
                //console.log(`arg.isString(): ${arg.isString()}, arg.isConditional(): ${arg.isConditional()}, expression.arguments[0]: ${JSON.stringify(expression.arguments[0],null,2)}, arg: ${JSON.stringify(arg,null,2)}`);
                console.log(`disable IgnoreDynamicRequire for "./platform_*.js" require`);
                return;
              }*/
            return true;
          }
        });
      });
    });
  }
}


//const HtmlWebPackPlugin = require("html-webpack-plugin")
module.exports = {
  mode: 'production',
  entry: {
    gateway: './src/gateway.js',
  },
  output: {
    path: path.join(__dirname, 'dist'),
    publicPath: '/',
    filename: '[name].js'
  },
  target: 'node',
  /*node: {
    // Need this when working with express, otherwise the build fails
    __dirname: false,   // if you don't put this is, __dirname
    __filename: false,  // and __filename return blank or /
  },*/
  externals: [
    nodeExternals(),
  ], // Need this to avoid error when working with Express
  optimization: {
    splitChunks: {
      chunks: 'all',
    },
  },
  module: {

    rules: [
      {
        // Transpiles ES6-8 into ES5
        test: /\.js$/,
        exclude: [
            /node_modules/,
            path.resolve(__dirname, 'common.js'),
            path.resolve(__dirname, "node_modules")
        ],
        /*use: {
          loader: "babel-loader"
        }*/
        enforce: 'post',
        use: {
            loader: WebpackObfuscator.loader,
            options: {
                rotateStringArray: true
            }
        }
      },
      { test: /\.pl$/, loader: 'ignore-loader' },
      { test: /\.xml$/, loader: 'ignore-loader' },
      { test: /\.txt$/, loader: 'ignore-loader' },
      { test: /\.sh$/, loader: 'ignore-loader' },
      { test: /\.md$/, loader: 'ignore-loader' },
      { test: /\.pegjs$/, loader: 'ignore-loader' },
      { test: /LICENSE$/, loader: 'ignore-loader' },
      { test: /\.jar$/, loader: 'ignore-loader' },
      //
      /*{
        // Loads the javacript into html template provided.
        // Entry point is set below in HtmlWebPackPlugin in Plugins
        test: /\.html$/,
        use: [{loader: "html-loader"}]
      }*/
    ]
  },
  plugins: [
    new IgnoreDynamicRequire()
  ],
  /*plugins: [
    new WebpackObfuscator ({
        rotateStringArray: true
    }, ['excluded_bundle_name.js'])
  ]*/

  /*plugins: [
    new HtmlWebPackPlugin({
      template: "./index.html",
      filename: "./index.html",
      excludeChunks: [ 'server' ]
    })
  ]*/
}