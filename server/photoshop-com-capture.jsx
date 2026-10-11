// PromptWizard 的 Photoshop COM 直连脚本（ExtendScript，ES3）。
// 花括号占位符由 photoshop-com-capture.ps1 在执行前替换。
// 注意：ExtendScript 没有 JSON 对象，这里自带一个极小的序列化实现。
(function () {
  var ACTION = '{{ACTION}}';
  var DOC_INDEX = {{DOC_INDEX}};
  var MAX_SIZE = {{MAX_SIZE}};
  var OUT_PATH = '{{OUT_PATH}}';

  function px(value) {
    return Math.round(Number(value.as('px')));
  }

  function esc(text) {
    var source = String(text);
    var out = '';
    for (var i = 0; i < source.length; i++) {
      var c = source.charAt(i);
      if (c === '\\') out += '\\\\';
      else if (c === '"') out += '\\"';
      else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (c < ' ') out += ' ';
      else out += c;
    }
    return out;
  }

  function pwJson(value) {
    if (value === null || value === undefined) return 'null';
    var type = typeof value;
    if (type === 'number') return isFinite(value) ? String(value) : '0';
    if (type === 'boolean') return value ? 'true' : 'false';
    if (type === 'string') return '"' + esc(value) + '"';
    if (value instanceof Array) {
      var items = [];
      for (var i = 0; i < value.length; i++) items.push(pwJson(value[i]));
      return '[' + items.join(',') + ']';
    }
    var fields = [];
    for (var key in value) {
      if (value.hasOwnProperty(key)) fields.push('"' + esc(key) + '":' + pwJson(value[key]));
    }
    return '{' + fields.join(',') + '}';
  }

  function collect() {
    var items = [];
    for (var i = 0; i < app.documents.length; i++) {
      var doc = app.documents[i];
      items.push({
        index: i,
        name: String(doc.name),
        width: px(doc.width),
        height: px(doc.height),
        isActive: doc === app.activeDocument,
        saved: doc.saved ? true : false,
        layers: doc.layers ? doc.layers.length : 0
      });
    }
    return items;
  }

  function activeIndex(items) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].isActive) return i;
    }
    return 0;
  }

  var documents = collect();

  if (ACTION === 'list') {
    return pwJson(documents);
  }

  if (documents.length === 0) {
    throw new Error('NO_DOCUMENT');
  }

  var useIndex = DOC_INDEX < 0 ? activeIndex(documents) : DOC_INDEX;
  var source = app.documents[useIndex];
  if (!source) {
    throw new Error('DOCUMENT_NOT_FOUND');
  }

  var sourceWidth = documents[useIndex].width;
  var sourceHeight = documents[useIndex].height;
  var scale = Math.min(1, MAX_SIZE / Math.max(sourceWidth, sourceHeight));
  var targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  var targetHeight = Math.max(1, Math.round(sourceHeight * scale));

  // 复制一份再打平，原文档完全不动。
  var copy = source.duplicate('PromptWizard export', false);
  try {
    copy.flatten();
    if (scale < 1) {
      copy.resizeImage(
        UnitValue(targetWidth, 'px'),
        UnitValue(targetHeight, 'px'),
        copy.resolution,
        ResampleMethod.BICUBIC
      );
    }
    var options = new JPEGSaveOptions();
    options.quality = 10;
    options.embedColorProfile = true;
    options.formatOptions = FormatOptions.STANDARDBASELINE;
    copy.saveAs(new File(OUT_PATH), options, true);
  } finally {
    copy.close(SaveOptions.DONOTSAVECHANGES);
  }

  return pwJson({
    name: String(source.name).replace(/\.[^.]+$/, ''),
    width: targetWidth,
    height: targetHeight,
    sourceWidth: sourceWidth,
    sourceHeight: sourceHeight,
    layers: documents[useIndex].layers,
    scaled: scale < 1,
    active: documents[useIndex].isActive
  });
})();
