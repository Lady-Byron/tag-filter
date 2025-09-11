'use strict';
const flarumWebpack = require('flarum-webpack-config');

module.exports = flarumWebpack({
  useExtensions: ['flarum/tags'],
  entries: {
    forum: './js/forum.js', // ← 采用官方推荐入口
  },
});
