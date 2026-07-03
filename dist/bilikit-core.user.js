// ==UserScript==
// @name         BiliKit Core
// @namespace    https://github.com/shiinayane/BiliKit
// @version      0.5.0
// @author       shiinayane
// @description  B 站体验增强核心，一装到位：CDN 优选（救海外卡顿）· 埋点/广告拦截（省流量降开销）· 免登录看评论/动态/1080p · 主题跟随系统深浅 · 评论显 IP 属地 · 播放不息屏——统一设置面板集中开关。Safari 友好、无需扩展、零外部依赖。
// @license      MIT
// @match        *://*.bilibili.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  'use strict';

  const KEY = "bilikit:settings";
  const CK = "bilikit_settings";
  const SENSITIVE = /accessKey|token|secret|passwd|password/i;
  const SETTINGS_EVENT = "bilikit:settings-changed";
  function readLocal() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") ?? {};
    } catch {
      return {};
    }
  }
  function readCookie() {
    try {
      const m = document.cookie.match(/(?:^|;\s*)bilikit_settings=([^;]*)/);
      if (!m || !m[1]) return null;
      return JSON.parse(decodeURIComponent(m[1]));
    } catch {
      return null;
    }
  }
  function toCookieStore(s) {
    const out = {};
    for (const k in s) if (!SENSITIVE.test(k)) out[k] = s[k];
    return out;
  }
  function writeCookie(s) {
    try {
      const v = encodeURIComponent(JSON.stringify(toCookieStore(s)));
      document.cookie = `${CK}=${v}; path=/; domain=.bilibili.com; max-age=31536000; SameSite=Lax`;
    } catch {
    }
  }
  function load() {
    const local = readLocal();
    const c = readCookie();
    return c ? { ...local, ...c } : local;
  }
  function save(s) {
    writeCookie(s);
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
      try {
        window.dispatchEvent(new Event(SETTINGS_EVENT));
      } catch {
      }
      return true;
    } catch {
      return false;
    }
  }
  function syncSharedSettings() {
    const c = readCookie();
    const local = readLocal();
    if (c) {
      try {
        localStorage.setItem(KEY, JSON.stringify({ ...local, ...c }));
      } catch {
      }
    } else if (Object.keys(local).length) {
      writeCookie(local);
    }
  }
  function get(key, fallback) {
    const s = load();
    return key in s ? s[key] : fallback;
  }
  function set(key, value) {
    const s = load();
    s[key] = value;
    return save(s);
  }
  const enabledKey = (id) => `module.${id}.enabled`;
  function isModuleEnabled(m) {
    return get(enabledKey(m.id), m.defaultEnabled !== false);
  }
  function setModuleEnabled(id, on) {
    set(enabledKey(id), on);
  }
  const cfgKey = (id, key) => `module.${id}.cfg.${key}`;
  function getField(m, key) {
    var _a;
    const field = (_a = m.settings) == null ? void 0 : _a.find((f) => f.key === key);
    return get(cfgKey(m.id, key), field ? field.default : void 0);
  }
  function setField(id, key, value) {
    return set(cfgKey(id, key), value);
  }
  function makeCfg(m) {
    return {
      get: (key) => getField(m, key)
    };
  }
  const registry = [];
  function register(...mods) {
    for (const m of mods) {
      if (registry.some((x) => x.id === m.id)) {
        console.warn(`[BiliKit] 模块 id 重复，已忽略：${m.id}`);
        continue;
      }
      registry.push(m);
    }
  }
  function getModules() {
    return registry;
  }
  function runAll() {
    for (const m of registry) {
      if (!isModuleEnabled(m)) continue;
      const go = () => {
        try {
          m.init(makeCfg(m));
        } catch (e) {
          console.error(`[BiliKit] 模块「${m.id}」初始化出错：`, e);
        }
      };
      if (m.runAt === "idle" && document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", go, { once: true });
      } else {
        go();
      }
    }
  }
  const qrcode = function(typeNumber, errorCorrectionLevel) {
    const PAD0 = 236;
    const PAD1 = 17;
    let _typeNumber = typeNumber;
    const _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    let _modules = null;
    let _moduleCount = 0;
    let _dataCache = null;
    const _dataList = [];
    const _this = {};
    const makeImpl = function(test, maskPattern) {
      _moduleCount = _typeNumber * 4 + 17;
      _modules = (function(moduleCount) {
        const modules = new Array(moduleCount);
        for (let row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (let col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      })(_moduleCount);
      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);
      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }
      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }
      mapData(_dataCache, maskPattern);
    };
    const setupPositionProbePattern = function(row, col) {
      for (let r = -1; r <= 7; r += 1) {
        if (row + r <= -1 || _moduleCount <= row + r) continue;
        for (let c = -1; c <= 7; c += 1) {
          if (col + c <= -1 || _moduleCount <= col + c) continue;
          if (0 <= r && r <= 6 && (c == 0 || c == 6) || 0 <= c && c <= 6 && (r == 0 || r == 6) || 2 <= r && r <= 4 && 2 <= c && c <= 4) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };
    const getBestMaskPattern = function() {
      let minLostPoint = 0;
      let pattern = 0;
      for (let i = 0; i < 8; i += 1) {
        makeImpl(true, i);
        const lostPoint = QRUtil.getLostPoint(_this);
        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }
      return pattern;
    };
    const setupTimingPattern = function() {
      for (let r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = r % 2 == 0;
      }
      for (let c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = c % 2 == 0;
      }
    };
    const setupPositionAdjustPattern = function() {
      const pos = QRUtil.getPatternPosition(_typeNumber);
      for (let i = 0; i < pos.length; i += 1) {
        for (let j = 0; j < pos.length; j += 1) {
          const row = pos[i];
          const col = pos[j];
          if (_modules[row][col] != null) {
            continue;
          }
          for (let r = -2; r <= 2; r += 1) {
            for (let c = -2; c <= 2; c += 1) {
              if (r == -2 || r == 2 || c == -2 || c == 2 || r == 0 && c == 0) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };
    const setupTypeNumber = function(test) {
      const bits = QRUtil.getBCHTypeNumber(_typeNumber);
      for (let i = 0; i < 18; i += 1) {
        const mod = !test && (bits >> i & 1) == 1;
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }
      for (let i = 0; i < 18; i += 1) {
        const mod = !test && (bits >> i & 1) == 1;
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };
    const setupTypeInfo = function(test, maskPattern) {
      const data = _errorCorrectionLevel << 3 | maskPattern;
      const bits = QRUtil.getBCHTypeInfo(data);
      for (let i = 0; i < 15; i += 1) {
        const mod = !test && (bits >> i & 1) == 1;
        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }
      for (let i = 0; i < 15; i += 1) {
        const mod = !test && (bits >> i & 1) == 1;
        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }
      _modules[_moduleCount - 8][8] = !test;
    };
    const mapData = function(data, maskPattern) {
      let inc = -1;
      let row = _moduleCount - 1;
      let bitIndex = 7;
      let byteIndex = 0;
      const maskFunc = QRUtil.getMaskFunction(maskPattern);
      for (let col = _moduleCount - 1; col > 0; col -= 2) {
        if (col == 6) col -= 1;
        while (true) {
          for (let c = 0; c < 2; c += 1) {
            if (_modules[row][col - c] == null) {
              let dark = false;
              if (byteIndex < data.length) {
                dark = (data[byteIndex] >>> bitIndex & 1) == 1;
              }
              const mask2 = maskFunc(row, col - c);
              if (mask2) {
                dark = !dark;
              }
              _modules[row][col - c] = dark;
              bitIndex -= 1;
              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }
          row += inc;
          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };
    const createBytes = function(buffer, rsBlocks) {
      let offset = 0;
      let maxDcCount = 0;
      let maxEcCount = 0;
      const dcdata = new Array(rsBlocks.length);
      const ecdata = new Array(rsBlocks.length);
      for (let r = 0; r < rsBlocks.length; r += 1) {
        const dcCount = rsBlocks[r].dataCount;
        const ecCount = rsBlocks[r].totalCount - dcCount;
        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);
        dcdata[r] = new Array(dcCount);
        for (let i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 255 & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;
        const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        const rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);
        const modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (let i = 0; i < ecdata[r].length; i += 1) {
          const modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = modIndex >= 0 ? modPoly.getAt(modIndex) : 0;
        }
      }
      let totalCodeCount = 0;
      for (let i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }
      const data = new Array(totalCodeCount);
      let index = 0;
      for (let i = 0; i < maxDcCount; i += 1) {
        for (let r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }
      for (let i = 0; i < maxEcCount; i += 1) {
        for (let r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }
      return data;
    };
    const createData = function(typeNumber2, errorCorrectionLevel2, dataList) {
      const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, errorCorrectionLevel2);
      const buffer = qrBitBuffer();
      for (let i = 0; i < dataList.length; i += 1) {
        const data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
        data.write(buffer);
      }
      let totalDataCount = 0;
      for (let i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }
      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw "code length overflow. (" + buffer.getLengthInBits() + ">" + totalDataCount * 8 + ")";
      }
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }
      while (true) {
        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);
        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }
      return createBytes(buffer, rsBlocks);
    };
    _this.addData = function(data, mode) {
      mode = mode || "Byte";
      let newData = null;
      switch (mode) {
        case "Numeric":
          newData = qrNumber(data);
          break;
        case "Alphanumeric":
          newData = qrAlphaNum(data);
          break;
        case "Byte":
          newData = qr8BitByte(data);
          break;
        case "Kanji":
          newData = qrKanji(data);
          break;
        default:
          throw "mode:" + mode;
      }
      _dataList.push(newData);
      _dataCache = null;
    };
    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + "," + col;
      }
      return _modules[row][col];
    };
    _this.getModuleCount = function() {
      return _moduleCount;
    };
    _this.make = function() {
      if (_typeNumber < 1) {
        let typeNumber2 = 1;
        for (; typeNumber2 < 40; typeNumber2++) {
          const rsBlocks = QRRSBlock.getRSBlocks(typeNumber2, _errorCorrectionLevel);
          const buffer = qrBitBuffer();
          for (let i = 0; i < _dataList.length; i++) {
            const data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber2));
            data.write(buffer);
          }
          let totalDataCount = 0;
          for (let i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }
          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }
        _typeNumber = typeNumber2;
      }
      makeImpl(false, getBestMaskPattern());
    };
    _this.createTableTag = function(cellSize, margin) {
      cellSize = cellSize || 2;
      margin = typeof margin == "undefined" ? cellSize * 4 : margin;
      let qrHtml = "";
      qrHtml += '<table style="';
      qrHtml += " border-width: 0px; border-style: none;";
      qrHtml += " border-collapse: collapse;";
      qrHtml += " padding: 0px; margin: " + margin + "px;";
      qrHtml += '">';
      qrHtml += "<tbody>";
      for (let r = 0; r < _this.getModuleCount(); r += 1) {
        qrHtml += "<tr>";
        for (let c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += " border-width: 0px; border-style: none;";
          qrHtml += " border-collapse: collapse;";
          qrHtml += " padding: 0px; margin: 0px;";
          qrHtml += " width: " + cellSize + "px;";
          qrHtml += " height: " + cellSize + "px;";
          qrHtml += " background-color: ";
          qrHtml += _this.isDark(r, c) ? "#000000" : "#ffffff";
          qrHtml += ";";
          qrHtml += '"/>';
        }
        qrHtml += "</tr>";
      }
      qrHtml += "</tbody>";
      qrHtml += "</table>";
      return qrHtml;
    };
    _this.createSvgTag = function(cellSize, margin, alt, title) {
      let opts = {};
      if (typeof arguments[0] == "object") {
        opts = arguments[0];
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }
      cellSize = cellSize || 2;
      margin = typeof margin == "undefined" ? cellSize * 4 : margin;
      alt = typeof alt === "string" ? { text: alt } : alt || {};
      alt.text = alt.text || null;
      alt.id = alt.text ? alt.id || "qrcode-description" : null;
      title = typeof title === "string" ? { text: title } : title || {};
      title.text = title.text || null;
      title.id = title.text ? title.id || "qrcode-title" : null;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      let c, mc, r, mr, qrSvg = "", rect;
      rect = "l" + cellSize + ",0 0," + cellSize + " -" + cellSize + ",0 0,-" + cellSize + "z ";
      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : "";
      qrSvg += ' viewBox="0 0 ' + size + " " + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += title.text || alt.text ? ' role="img" aria-labelledby="' + escapeXml([title.id, alt.id].join(" ").trim()) + '"' : "";
      qrSvg += ">";
      qrSvg += title.text ? '<title id="' + escapeXml(title.id) + '">' + escapeXml(title.text) + "</title>" : "";
      qrSvg += alt.text ? '<description id="' + escapeXml(alt.id) + '">' + escapeXml(alt.text) + "</description>" : "";
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';
      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c)) {
            mc = c * cellSize + margin;
            qrSvg += "M" + mc + "," + mr + rect;
          }
        }
      }
      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += "</svg>";
      return qrSvg;
    };
    _this.createDataURL = function(cellSize, margin) {
      cellSize = cellSize || 2;
      margin = typeof margin == "undefined" ? cellSize * 4 : margin;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      const min = margin;
      const max = size - margin;
      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          const c = Math.floor((x - min) / cellSize);
          const r = Math.floor((y - min) / cellSize);
          return _this.isDark(r, c) ? 0 : 1;
        } else {
          return 1;
        }
      });
    };
    _this.createImgTag = function(cellSize, margin, alt) {
      cellSize = cellSize || 2;
      margin = typeof margin == "undefined" ? cellSize * 4 : margin;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      let img = "";
      img += "<img";
      img += ' src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += ' width="';
      img += size;
      img += '"';
      img += ' height="';
      img += size;
      img += '"';
      if (alt) {
        img += ' alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += "/>";
      return img;
    };
    const escapeXml = function(s) {
      let escaped = "";
      for (let i = 0; i < s.length; i += 1) {
        const c = s.charAt(i);
        switch (c) {
          case "<":
            escaped += "&lt;";
            break;
          case ">":
            escaped += "&gt;";
            break;
          case "&":
            escaped += "&amp;";
            break;
          case '"':
            escaped += "&quot;";
            break;
          default:
            escaped += c;
            break;
        }
      }
      return escaped;
    };
    const _createHalfASCII = function(margin) {
      const cellSize = 1;
      margin = typeof margin == "undefined" ? cellSize * 2 : margin;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      const min = margin;
      const max = size - margin;
      let y, x, r1, r2, p;
      const blocks = {
        "██": "█",
        "█ ": "▀",
        " █": "▄",
        "  ": " "
      };
      const blocksLastLineNoMargin = {
        "██": "▀",
        "█ ": "▀",
        " █": " ",
        "  ": " "
      };
      let ascii = "";
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = "█";
          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = " ";
          }
          if (min <= x && x < max && min <= y + 1 && y + 1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += " ";
          } else {
            p += "█";
          }
          ascii += margin < 1 && y + 1 >= max ? blocksLastLineNoMargin[p] : blocks[p];
        }
        ascii += "\n";
      }
      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size + 1).join("▀");
      }
      return ascii.substring(0, ascii.length - 1);
    };
    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;
      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }
      cellSize -= 1;
      margin = typeof margin == "undefined" ? cellSize * 2 : margin;
      const size = _this.getModuleCount() * cellSize + margin * 2;
      const min = margin;
      const max = size - margin;
      let y, x, r, p;
      const white = Array(cellSize + 1).join("██");
      const black = Array(cellSize + 1).join("  ");
      let ascii = "";
      let line = "";
      for (y = 0; y < size; y += 1) {
        r = Math.floor((y - min) / cellSize);
        line = "";
        for (x = 0; x < size; x += 1) {
          p = 1;
          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }
          line += p ? white : black;
        }
        for (r = 0; r < cellSize; r += 1) {
          ascii += line + "\n";
        }
      }
      return ascii.substring(0, ascii.length - 1);
    };
    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      const length = _this.getModuleCount();
      for (let row = 0; row < length; row++) {
        for (let col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? "black" : "white";
          context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    };
    return _this;
  };
  qrcode.stringToBytes = function(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i += 1) {
      const c = s.charCodeAt(i);
      bytes.push(c & 255);
    }
    return bytes;
  };
  qrcode.createStringToBytes = function(unicodeData, numChars) {
    const unicodeMap = (function() {
      const bin = base64DecodeInputStream(unicodeData);
      const read = function() {
        const b = bin.read();
        if (b == -1) throw "eof";
        return b;
      };
      let count = 0;
      const unicodeMap2 = {};
      while (true) {
        const b0 = bin.read();
        if (b0 == -1) break;
        const b1 = read();
        const b2 = read();
        const b3 = read();
        const k = String.fromCharCode(b0 << 8 | b1);
        const v = b2 << 8 | b3;
        unicodeMap2[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + " != " + numChars;
      }
      return unicodeMap2;
    })();
    const unknownChar = "?".charCodeAt(0);
    return function(s) {
      const bytes = [];
      for (let i = 0; i < s.length; i += 1) {
        const c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          const b = unicodeMap[s.charAt(i)];
          if (typeof b == "number") {
            if ((b & 255) == b) {
              bytes.push(b);
            } else {
              bytes.push(b >>> 8);
              bytes.push(b & 255);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };
  const QRMode = {
    MODE_NUMBER: 1 << 0,
    MODE_ALPHA_NUM: 1 << 1,
    MODE_8BIT_BYTE: 1 << 2,
    MODE_KANJI: 1 << 3
  };
  const QRErrorCorrectionLevel = {
    L: 1,
    M: 0,
    Q: 3,
    H: 2
  };
  const QRMaskPattern = {
    PATTERN000: 0,
    PATTERN001: 1,
    PATTERN010: 2,
    PATTERN011: 3,
    PATTERN100: 4,
    PATTERN101: 5,
    PATTERN110: 6,
    PATTERN111: 7
  };
  const QRUtil = (function() {
    const PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    const G15 = 1 << 10 | 1 << 8 | 1 << 5 | 1 << 4 | 1 << 2 | 1 << 1 | 1 << 0;
    const G18 = 1 << 12 | 1 << 11 | 1 << 10 | 1 << 9 | 1 << 8 | 1 << 5 | 1 << 2 | 1 << 0;
    const G15_MASK = 1 << 14 | 1 << 12 | 1 << 10 | 1 << 4 | 1 << 1;
    const _this = {};
    const getBCHDigit = function(data) {
      let digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };
    _this.getBCHTypeInfo = function(data) {
      let d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= G15 << getBCHDigit(d) - getBCHDigit(G15);
      }
      return (data << 10 | d) ^ G15_MASK;
    };
    _this.getBCHTypeNumber = function(data) {
      let d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= G18 << getBCHDigit(d) - getBCHDigit(G18);
      }
      return data << 12 | d;
    };
    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };
    _this.getMaskFunction = function(maskPattern) {
      switch (maskPattern) {
        case QRMaskPattern.PATTERN000:
          return function(i, j) {
            return (i + j) % 2 == 0;
          };
        case QRMaskPattern.PATTERN001:
          return function(i, j) {
            return i % 2 == 0;
          };
        case QRMaskPattern.PATTERN010:
          return function(i, j) {
            return j % 3 == 0;
          };
        case QRMaskPattern.PATTERN011:
          return function(i, j) {
            return (i + j) % 3 == 0;
          };
        case QRMaskPattern.PATTERN100:
          return function(i, j) {
            return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 == 0;
          };
        case QRMaskPattern.PATTERN101:
          return function(i, j) {
            return i * j % 2 + i * j % 3 == 0;
          };
        case QRMaskPattern.PATTERN110:
          return function(i, j) {
            return (i * j % 2 + i * j % 3) % 2 == 0;
          };
        case QRMaskPattern.PATTERN111:
          return function(i, j) {
            return (i * j % 3 + (i + j) % 2) % 2 == 0;
          };
        default:
          throw "bad maskPattern:" + maskPattern;
      }
    };
    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      let a = qrPolynomial([1], 0);
      for (let i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0));
      }
      return a;
    };
    _this.getLengthInBits = function(mode, type) {
      if (1 <= type && type < 10) {
        switch (mode) {
          case QRMode.MODE_NUMBER:
            return 10;
          case QRMode.MODE_ALPHA_NUM:
            return 9;
          case QRMode.MODE_8BIT_BYTE:
            return 8;
          case QRMode.MODE_KANJI:
            return 8;
          default:
            throw "mode:" + mode;
        }
      } else if (type < 27) {
        switch (mode) {
          case QRMode.MODE_NUMBER:
            return 12;
          case QRMode.MODE_ALPHA_NUM:
            return 11;
          case QRMode.MODE_8BIT_BYTE:
            return 16;
          case QRMode.MODE_KANJI:
            return 10;
          default:
            throw "mode:" + mode;
        }
      } else if (type < 41) {
        switch (mode) {
          case QRMode.MODE_NUMBER:
            return 14;
          case QRMode.MODE_ALPHA_NUM:
            return 13;
          case QRMode.MODE_8BIT_BYTE:
            return 16;
          case QRMode.MODE_KANJI:
            return 12;
          default:
            throw "mode:" + mode;
        }
      } else {
        throw "type:" + type;
      }
    };
    _this.getLostPoint = function(qrcode2) {
      const moduleCount = qrcode2.getModuleCount();
      let lostPoint = 0;
      for (let row = 0; row < moduleCount; row += 1) {
        for (let col = 0; col < moduleCount; col += 1) {
          let sameCount = 0;
          const dark = qrcode2.isDark(row, col);
          for (let r = -1; r <= 1; r += 1) {
            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }
            for (let c = -1; c <= 1; c += 1) {
              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }
              if (r == 0 && c == 0) {
                continue;
              }
              if (dark == qrcode2.isDark(row + r, col + c)) {
                sameCount += 1;
              }
            }
          }
          if (sameCount > 5) {
            lostPoint += 3 + sameCount - 5;
          }
        }
      }
      for (let row = 0; row < moduleCount - 1; row += 1) {
        for (let col = 0; col < moduleCount - 1; col += 1) {
          let count = 0;
          if (qrcode2.isDark(row, col)) count += 1;
          if (qrcode2.isDark(row + 1, col)) count += 1;
          if (qrcode2.isDark(row, col + 1)) count += 1;
          if (qrcode2.isDark(row + 1, col + 1)) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }
      for (let row = 0; row < moduleCount; row += 1) {
        for (let col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode2.isDark(row, col) && !qrcode2.isDark(row, col + 1) && qrcode2.isDark(row, col + 2) && qrcode2.isDark(row, col + 3) && qrcode2.isDark(row, col + 4) && !qrcode2.isDark(row, col + 5) && qrcode2.isDark(row, col + 6)) {
            lostPoint += 40;
          }
        }
      }
      for (let col = 0; col < moduleCount; col += 1) {
        for (let row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode2.isDark(row, col) && !qrcode2.isDark(row + 1, col) && qrcode2.isDark(row + 2, col) && qrcode2.isDark(row + 3, col) && qrcode2.isDark(row + 4, col) && !qrcode2.isDark(row + 5, col) && qrcode2.isDark(row + 6, col)) {
            lostPoint += 40;
          }
        }
      }
      let darkCount = 0;
      for (let col = 0; col < moduleCount; col += 1) {
        for (let row = 0; row < moduleCount; row += 1) {
          if (qrcode2.isDark(row, col)) {
            darkCount += 1;
          }
        }
      }
      const ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;
      return lostPoint;
    };
    return _this;
  })();
  const QRMath = (function() {
    const EXP_TABLE = new Array(256);
    const LOG_TABLE = new Array(256);
    for (let i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (let i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
    }
    for (let i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i]] = i;
    }
    const _this = {};
    _this.glog = function(n) {
      if (n < 1) {
        throw "glog(" + n + ")";
      }
      return LOG_TABLE[n];
    };
    _this.gexp = function(n) {
      while (n < 0) {
        n += 255;
      }
      while (n >= 256) {
        n -= 255;
      }
      return EXP_TABLE[n];
    };
    return _this;
  })();
  const qrPolynomial = function(num, shift) {
    if (typeof num.length == "undefined") {
      throw num.length + "/" + shift;
    }
    const _num = (function() {
      let offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      const _num2 = new Array(num.length - offset + shift);
      for (let i = 0; i < num.length - offset; i += 1) {
        _num2[i] = num[i + offset];
      }
      return _num2;
    })();
    const _this = {};
    _this.getAt = function(index) {
      return _num[index];
    };
    _this.getLength = function() {
      return _num.length;
    };
    _this.multiply = function(e) {
      const num2 = new Array(_this.getLength() + e.getLength() - 1);
      for (let i = 0; i < _this.getLength(); i += 1) {
        for (let j = 0; j < e.getLength(); j += 1) {
          num2[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i)) + QRMath.glog(e.getAt(j)));
        }
      }
      return qrPolynomial(num2, 0);
    };
    _this.mod = function(e) {
      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }
      const ratio = QRMath.glog(_this.getAt(0)) - QRMath.glog(e.getAt(0));
      const num2 = new Array(_this.getLength());
      for (let i = 0; i < _this.getLength(); i += 1) {
        num2[i] = _this.getAt(i);
      }
      for (let i = 0; i < e.getLength(); i += 1) {
        num2[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i)) + ratio);
      }
      return qrPolynomial(num2, 0).mod(e);
    };
    return _this;
  };
  const QRRSBlock = (function() {
    const RS_BLOCK_TABLE = [
      // L
      // M
      // Q
      // H
      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],
      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],
      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],
      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],
      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],
      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],
      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],
      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],
      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],
      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],
      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],
      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],
      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],
      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],
      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],
      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],
      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],
      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],
      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],
      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],
      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],
      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],
      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],
      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],
      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],
      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],
      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],
      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],
      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],
      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],
      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],
      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],
      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],
      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],
      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],
      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],
      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],
      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],
      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],
      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];
    const qrRSBlock = function(totalCount, dataCount) {
      const _this2 = {};
      _this2.totalCount = totalCount;
      _this2.dataCount = dataCount;
      return _this2;
    };
    const _this = {};
    const getRsBlockTable = function(typeNumber, errorCorrectionLevel) {
      switch (errorCorrectionLevel) {
        case QRErrorCorrectionLevel.L:
          return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
        case QRErrorCorrectionLevel.M:
          return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
        case QRErrorCorrectionLevel.Q:
          return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
        case QRErrorCorrectionLevel.H:
          return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
        default:
          return void 0;
      }
    };
    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {
      const rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);
      if (typeof rsBlock == "undefined") {
        throw "bad rs block @ typeNumber:" + typeNumber + "/errorCorrectionLevel:" + errorCorrectionLevel;
      }
      const length = rsBlock.length / 3;
      const list = [];
      for (let i = 0; i < length; i += 1) {
        const count = rsBlock[i * 3 + 0];
        const totalCount = rsBlock[i * 3 + 1];
        const dataCount = rsBlock[i * 3 + 2];
        for (let j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount));
        }
      }
      return list;
    };
    return _this;
  })();
  const qrBitBuffer = function() {
    const _buffer = [];
    let _length = 0;
    const _this = {};
    _this.getBuffer = function() {
      return _buffer;
    };
    _this.getAt = function(index) {
      const bufIndex = Math.floor(index / 8);
      return (_buffer[bufIndex] >>> 7 - index % 8 & 1) == 1;
    };
    _this.put = function(num, length) {
      for (let i = 0; i < length; i += 1) {
        _this.putBit((num >>> length - i - 1 & 1) == 1);
      }
    };
    _this.getLengthInBits = function() {
      return _length;
    };
    _this.putBit = function(bit) {
      const bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }
      if (bit) {
        _buffer[bufIndex] |= 128 >>> _length % 8;
      }
      _length += 1;
    };
    return _this;
  };
  const qrNumber = function(data) {
    const _mode = QRMode.MODE_NUMBER;
    const _data = data;
    const _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return _data.length;
    };
    _this.write = function(buffer) {
      const data2 = _data;
      let i = 0;
      while (i + 2 < data2.length) {
        buffer.put(strToNum(data2.substring(i, i + 3)), 10);
        i += 3;
      }
      if (i < data2.length) {
        if (data2.length - i == 1) {
          buffer.put(strToNum(data2.substring(i, i + 1)), 4);
        } else if (data2.length - i == 2) {
          buffer.put(strToNum(data2.substring(i, i + 2)), 7);
        }
      }
    };
    const strToNum = function(s) {
      let num = 0;
      for (let i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i));
      }
      return num;
    };
    const chatToNum = function(c) {
      if ("0" <= c && c <= "9") {
        return c.charCodeAt(0) - "0".charCodeAt(0);
      }
      throw "illegal char :" + c;
    };
    return _this;
  };
  const qrAlphaNum = function(data) {
    const _mode = QRMode.MODE_ALPHA_NUM;
    const _data = data;
    const _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return _data.length;
    };
    _this.write = function(buffer) {
      const s = _data;
      let i = 0;
      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i)) * 45 + getCode(s.charAt(i + 1)),
          11
        );
        i += 2;
      }
      if (i < s.length) {
        buffer.put(getCode(s.charAt(i)), 6);
      }
    };
    const getCode = function(c) {
      if ("0" <= c && c <= "9") {
        return c.charCodeAt(0) - "0".charCodeAt(0);
      } else if ("A" <= c && c <= "Z") {
        return c.charCodeAt(0) - "A".charCodeAt(0) + 10;
      } else {
        switch (c) {
          case " ":
            return 36;
          case "$":
            return 37;
          case "%":
            return 38;
          case "*":
            return 39;
          case "+":
            return 40;
          case "-":
            return 41;
          case ".":
            return 42;
          case "/":
            return 43;
          case ":":
            return 44;
          default:
            throw "illegal char :" + c;
        }
      }
    };
    return _this;
  };
  const qr8BitByte = function(data) {
    const _mode = QRMode.MODE_8BIT_BYTE;
    const _bytes = qrcode.stringToBytes(data);
    const _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return _bytes.length;
    };
    _this.write = function(buffer) {
      for (let i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };
    return _this;
  };
  const qrKanji = function(data) {
    const _mode = QRMode.MODE_KANJI;
    const stringToBytes = qrcode.stringToBytes;
    !(function(c, code) {
      const test = stringToBytes(c);
      if (test.length != 2 || (test[0] << 8 | test[1]) != code) {
        throw "sjis not supported.";
      }
    })("友", 38726);
    const _bytes = stringToBytes(data);
    const _this = {};
    _this.getMode = function() {
      return _mode;
    };
    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };
    _this.write = function(buffer) {
      const data2 = _bytes;
      let i = 0;
      while (i + 1 < data2.length) {
        let c = (255 & data2[i]) << 8 | 255 & data2[i + 1];
        if (33088 <= c && c <= 40956) {
          c -= 33088;
        } else if (57408 <= c && c <= 60351) {
          c -= 49472;
        } else {
          throw "illegal char at " + (i + 1) + "/" + c;
        }
        c = (c >>> 8 & 255) * 192 + (c & 255);
        buffer.put(c, 13);
        i += 2;
      }
      if (i < data2.length) {
        throw "illegal char at " + (i + 1);
      }
    };
    return _this;
  };
  const byteArrayOutputStream = function() {
    const _bytes = [];
    const _this = {};
    _this.writeByte = function(b) {
      _bytes.push(b & 255);
    };
    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };
    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (let i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };
    _this.writeString = function(s) {
      for (let i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i));
      }
    };
    _this.toByteArray = function() {
      return _bytes;
    };
    _this.toString = function() {
      let s = "";
      s += "[";
      for (let i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ",";
        }
        s += _bytes[i];
      }
      s += "]";
      return s;
    };
    return _this;
  };
  const base64EncodeOutputStream = function() {
    let _buffer = 0;
    let _buflen = 0;
    let _length = 0;
    let _base64 = "";
    const _this = {};
    const writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 63));
    };
    const encode = function(n) {
      if (n < 0) {
        throw "n:" + n;
      } else if (n < 26) {
        return 65 + n;
      } else if (n < 52) {
        return 97 + (n - 26);
      } else if (n < 62) {
        return 48 + (n - 52);
      } else if (n == 62) {
        return 43;
      } else if (n == 63) {
        return 47;
      } else {
        throw "n:" + n;
      }
    };
    _this.writeByte = function(n) {
      _buffer = _buffer << 8 | n & 255;
      _buflen += 8;
      _length += 1;
      while (_buflen >= 6) {
        writeEncoded(_buffer >>> _buflen - 6);
        _buflen -= 6;
      }
    };
    _this.flush = function() {
      if (_buflen > 0) {
        writeEncoded(_buffer << 6 - _buflen);
        _buffer = 0;
        _buflen = 0;
      }
      if (_length % 3 != 0) {
        const padlen = 3 - _length % 3;
        for (let i = 0; i < padlen; i += 1) {
          _base64 += "=";
        }
      }
    };
    _this.toString = function() {
      return _base64;
    };
    return _this;
  };
  const base64DecodeInputStream = function(str) {
    const _str = str;
    let _pos = 0;
    let _buffer = 0;
    let _buflen = 0;
    const _this = {};
    _this.read = function() {
      while (_buflen < 8) {
        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw "unexpected end of file./" + _buflen;
        }
        const c = _str.charAt(_pos);
        _pos += 1;
        if (c == "=") {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/)) {
          continue;
        }
        _buffer = _buffer << 6 | decode(c.charCodeAt(0));
        _buflen += 6;
      }
      const n = _buffer >>> _buflen - 8 & 255;
      _buflen -= 8;
      return n;
    };
    const decode = function(c) {
      if (65 <= c && c <= 90) {
        return c - 65;
      } else if (97 <= c && c <= 122) {
        return c - 97 + 26;
      } else if (48 <= c && c <= 57) {
        return c - 48 + 52;
      } else if (c == 43) {
        return 62;
      } else if (c == 47) {
        return 63;
      } else {
        throw "c:" + c;
      }
    };
    return _this;
  };
  const gifImage = function(width, height) {
    const _width = width;
    const _height = height;
    const _data = new Array(width * height);
    const _this = {};
    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };
    _this.write = function(out) {
      out.writeString("GIF87a");
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(128);
      out.writeByte(0);
      out.writeByte(0);
      out.writeByte(0);
      out.writeByte(0);
      out.writeByte(0);
      out.writeByte(255);
      out.writeByte(255);
      out.writeByte(255);
      out.writeString(",");
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);
      const lzwMinCodeSize = 2;
      const raster = getLZWRaster(lzwMinCodeSize);
      out.writeByte(lzwMinCodeSize);
      let offset = 0;
      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }
      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0);
      out.writeString(";");
    };
    const bitOutputStream = function(out) {
      const _out = out;
      let _bitLength = 0;
      let _bitBuffer = 0;
      const _this2 = {};
      _this2.write = function(data, length) {
        if (data >>> length != 0) {
          throw "length over";
        }
        while (_bitLength + length >= 8) {
          _out.writeByte(255 & (data << _bitLength | _bitBuffer));
          length -= 8 - _bitLength;
          data >>>= 8 - _bitLength;
          _bitBuffer = 0;
          _bitLength = 0;
        }
        _bitBuffer = data << _bitLength | _bitBuffer;
        _bitLength = _bitLength + length;
      };
      _this2.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };
      return _this2;
    };
    const getLZWRaster = function(lzwMinCodeSize) {
      const clearCode = 1 << lzwMinCodeSize;
      const endCode = (1 << lzwMinCodeSize) + 1;
      let bitLength = lzwMinCodeSize + 1;
      const table = lzwTable();
      for (let i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i));
      }
      table.add(String.fromCharCode(clearCode));
      table.add(String.fromCharCode(endCode));
      const byteOut = byteArrayOutputStream();
      const bitOut = bitOutputStream(byteOut);
      bitOut.write(clearCode, bitLength);
      let dataIndex = 0;
      let s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;
      while (dataIndex < _data.length) {
        const c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;
        if (table.contains(s + c)) {
          s = s + c;
        } else {
          bitOut.write(table.indexOf(s), bitLength);
          if (table.size() < 4095) {
            if (table.size() == 1 << bitLength) {
              bitLength += 1;
            }
            table.add(s + c);
          }
          s = c;
        }
      }
      bitOut.write(table.indexOf(s), bitLength);
      bitOut.write(endCode, bitLength);
      bitOut.flush();
      return byteOut.toByteArray();
    };
    const lzwTable = function() {
      const _map = {};
      let _size = 0;
      const _this2 = {};
      _this2.add = function(key) {
        if (_this2.contains(key)) {
          throw "dup key:" + key;
        }
        _map[key] = _size;
        _size += 1;
      };
      _this2.size = function() {
        return _size;
      };
      _this2.indexOf = function(key) {
        return _map[key];
      };
      _this2.contains = function(key) {
        return typeof _map[key] != "undefined";
      };
      return _this2;
    };
    return _this;
  };
  const createDataURL = function(width, height, getPixel) {
    const gif = gifImage(width, height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y));
      }
    }
    const b = byteArrayOutputStream();
    gif.write(b);
    const base64 = base64EncodeOutputStream();
    const bytes = b.toByteArray();
    for (let i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();
    return "data:image/gif;base64," + base64;
  };
  qrcode.stringToBytes;
  function md5(s) {
    function add32(a, b) {
      return a + b & 4294967295;
    }
    function cmn(q, a, b, x, sh, t) {
      a = add32(add32(a, q), add32(x, t));
      return add32(a << sh | a >>> 32 - sh, b);
    }
    function ff(a, b, c, d, x, s2, t) {
      return cmn(b & c | ~b & d, a, b, x, s2, t);
    }
    function gg(a, b, c, d, x, s2, t) {
      return cmn(b & d | c & ~d, a, b, x, s2, t);
    }
    function hh(a, b, c, d, x, s2, t) {
      return cmn(b ^ c ^ d, a, b, x, s2, t);
    }
    function ii(a, b, c, d, x, s2, t) {
      return cmn(c ^ (b | ~d), a, b, x, s2, t);
    }
    function cycle(x, k) {
      let a = x[0], b = x[1], c = x[2], d = x[3];
      a = ff(a, b, c, d, k[0], 7, -680876936);
      d = ff(d, a, b, c, k[1], 12, -389564586);
      c = ff(c, d, a, b, k[2], 17, 606105819);
      b = ff(b, c, d, a, k[3], 22, -1044525330);
      a = ff(a, b, c, d, k[4], 7, -176418897);
      d = ff(d, a, b, c, k[5], 12, 1200080426);
      c = ff(c, d, a, b, k[6], 17, -1473231341);
      b = ff(b, c, d, a, k[7], 22, -45705983);
      a = ff(a, b, c, d, k[8], 7, 1770035416);
      d = ff(d, a, b, c, k[9], 12, -1958414417);
      c = ff(c, d, a, b, k[10], 17, -42063);
      b = ff(b, c, d, a, k[11], 22, -1990404162);
      a = ff(a, b, c, d, k[12], 7, 1804603682);
      d = ff(d, a, b, c, k[13], 12, -40341101);
      c = ff(c, d, a, b, k[14], 17, -1502002290);
      b = ff(b, c, d, a, k[15], 22, 1236535329);
      a = gg(a, b, c, d, k[1], 5, -165796510);
      d = gg(d, a, b, c, k[6], 9, -1069501632);
      c = gg(c, d, a, b, k[11], 14, 643717713);
      b = gg(b, c, d, a, k[0], 20, -373897302);
      a = gg(a, b, c, d, k[5], 5, -701558691);
      d = gg(d, a, b, c, k[10], 9, 38016083);
      c = gg(c, d, a, b, k[15], 14, -660478335);
      b = gg(b, c, d, a, k[4], 20, -405537848);
      a = gg(a, b, c, d, k[9], 5, 568446438);
      d = gg(d, a, b, c, k[14], 9, -1019803690);
      c = gg(c, d, a, b, k[3], 14, -187363961);
      b = gg(b, c, d, a, k[8], 20, 1163531501);
      a = gg(a, b, c, d, k[13], 5, -1444681467);
      d = gg(d, a, b, c, k[2], 9, -51403784);
      c = gg(c, d, a, b, k[7], 14, 1735328473);
      b = gg(b, c, d, a, k[12], 20, -1926607734);
      a = hh(a, b, c, d, k[5], 4, -378558);
      d = hh(d, a, b, c, k[8], 11, -2022574463);
      c = hh(c, d, a, b, k[11], 16, 1839030562);
      b = hh(b, c, d, a, k[14], 23, -35309556);
      a = hh(a, b, c, d, k[1], 4, -1530992060);
      d = hh(d, a, b, c, k[4], 11, 1272893353);
      c = hh(c, d, a, b, k[7], 16, -155497632);
      b = hh(b, c, d, a, k[10], 23, -1094730640);
      a = hh(a, b, c, d, k[13], 4, 681279174);
      d = hh(d, a, b, c, k[0], 11, -358537222);
      c = hh(c, d, a, b, k[3], 16, -722521979);
      b = hh(b, c, d, a, k[6], 23, 76029189);
      a = hh(a, b, c, d, k[9], 4, -640364487);
      d = hh(d, a, b, c, k[12], 11, -421815835);
      c = hh(c, d, a, b, k[15], 16, 530742520);
      b = hh(b, c, d, a, k[2], 23, -995338651);
      a = ii(a, b, c, d, k[0], 6, -198630844);
      d = ii(d, a, b, c, k[7], 10, 1126891415);
      c = ii(c, d, a, b, k[14], 15, -1416354905);
      b = ii(b, c, d, a, k[5], 21, -57434055);
      a = ii(a, b, c, d, k[12], 6, 1700485571);
      d = ii(d, a, b, c, k[3], 10, -1894986606);
      c = ii(c, d, a, b, k[10], 15, -1051523);
      b = ii(b, c, d, a, k[1], 21, -2054922799);
      a = ii(a, b, c, d, k[8], 6, 1873313359);
      d = ii(d, a, b, c, k[15], 10, -30611744);
      c = ii(c, d, a, b, k[6], 15, -1560198380);
      b = ii(b, c, d, a, k[13], 21, 1309151649);
      a = ii(a, b, c, d, k[4], 6, -145523070);
      d = ii(d, a, b, c, k[11], 10, -1120210379);
      c = ii(c, d, a, b, k[2], 15, 718787259);
      b = ii(b, c, d, a, k[9], 21, -343485551);
      x[0] = add32(a, x[0]);
      x[1] = add32(b, x[1]);
      x[2] = add32(c, x[2]);
      x[3] = add32(d, x[3]);
    }
    function blk(str, i2) {
      const m = [];
      for (let j = 0; j < 64; j += 4) m[j >> 2] = str.charCodeAt(i2 + j) + (str.charCodeAt(i2 + j + 1) << 8) + (str.charCodeAt(i2 + j + 2) << 16) + (str.charCodeAt(i2 + j + 3) << 24);
      return m;
    }
    const n = s.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i;
    for (i = 64; i <= n; i += 64) cycle(state, blk(s, i - 64));
    s = s.substring(i - 64);
    const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << (i % 4 << 3);
    tail[i >> 2] |= 128 << (i % 4 << 3);
    if (i > 55) {
      cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = n * 8;
    cycle(state, tail);
    const hc = "0123456789abcdef";
    let out = "";
    for (const w of state) for (let j = 0; j < 4; j++) out += hc[w >> j * 8 + 4 & 15] + hc[w >> j * 8 & 15];
    return out;
  }
  const APPKEY = "4409e2ce8ffd12b8";
  const APPSEC = "59b43e04ad6965f34319062b478f83dd";
  function signAppQuery(params) {
    const p = { appkey: APPKEY, ...params };
    const sorted = Object.keys(p).sort().map((k) => `${k}=${encodeURIComponent(p[k])}`).join("&");
    return `${sorted}&sign=${md5(sorted + APPSEC)}`;
  }
  const PASSPORT = "https://passport.bilibili.com";
  async function postSigned(path, params) {
    const ts = String(Math.floor(Date.now() / 1e3));
    const body = signAppQuery({ ...params, local_id: "0", ts });
    const res = await fetch(PASSPORT + path, {
      method: "POST",
      credentials: "include",
      // 带 web 登录 cookie → SEC 视为可信会话
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("响应非 JSON（可能被风控拦截）");
    }
  }
  let root = null;
  let qrImg = null;
  let statusEl = null;
  let running = false;
  let pollTimer = null;
  function resetOverlayDom() {
    if (root) root.remove();
    root = qrImg = statusEl = null;
  }
  function closeOverlay() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    running = false;
    resetOverlayDom();
  }
  function openOverlay() {
    resetOverlayDom();
    root = document.createElement("div");
    const sr = root.attachShadow({ mode: "open" });
    sr.innerHTML = `<style>
    :host{ all:initial }
    .ov{ position:fixed; inset:0; z-index:2147483600; background:rgba(0,0,0,.55);
      display:flex; align-items:center; justify-content:center;
      font-family:-apple-system,"PingFang SC",sans-serif; -webkit-backdrop-filter:blur(2px); backdrop-filter:blur(2px); }
    .card{ width:300px; background:#1c1d22; color:#e3e5e7; border-radius:16px; padding:22px; text-align:center;
      box-shadow:0 16px 56px rgba(0,0,0,.5); }
    .title{ font-size:15px; font-weight:600; margin-bottom:4px } .title b{ color:#fb7299 }
    .hint{ font-size:12px; color:rgba(255,255,255,.45); margin-bottom:16px }
    .qr{ width:200px; height:200px; background:#fff; border-radius:10px; margin:0 auto; display:flex; align-items:center; justify-content:center; overflow:hidden }
    .qr img{ width:184px; height:184px; display:block }
    .status{ font-size:13px; color:rgba(255,255,255,.75); margin-top:16px; min-height:18px }
    .close{ margin-top:14px; cursor:pointer; color:rgba(255,255,255,.5); font-size:12px }
    .close:hover{ color:#fff }
    @media (prefers-color-scheme: light){
      .card{ background:#fff; color:#18191c; box-shadow:0 16px 56px rgba(0,0,0,.22) }
      .title b{ color:#d6336c } .hint{ color:rgba(0,0,0,.45) } .status{ color:rgba(0,0,0,.7) }
      .close{ color:rgba(0,0,0,.45) } .close:hover{ color:#000 }
    }
  </style>
  <div class="ov"><div class="card">
    <div class="title"><b>BiliKit</b> · 登录 App 推荐</div>
    <div class="hint">用手机哔哩哔哩 App 扫码</div>
    <div class="qr"><img alt=""></div>
    <div class="status">正在获取二维码…</div>
    <div class="close">取消</div>
  </div></div>`;
    qrImg = sr.querySelector("img");
    statusEl = sr.querySelector(".status");
    sr.querySelector(".close").addEventListener("click", closeOverlay);
    sr.querySelector(".ov").addEventListener("click", (e) => {
      if (e.target.classList.contains("ov")) closeOverlay();
    });
    document.body.appendChild(root);
  }
  function setStatus(t) {
    if (statusEl) statusEl.textContent = t;
  }
  function renderQR(url) {
    const qr = qrcode(0, "M");
    qr.addData(url);
    qr.make();
    if (qrImg) qrImg.src = qr.createDataURL(6, 8);
    setStatus("等待扫码…");
  }
  function startTvLogin(onSuccess) {
    if (running || window.top !== window.self) return;
    running = true;
    openOverlay();
    (async () => {
      try {
        const auth = await postSigned("/x/passport-tv-login/qrcode/auth_code", {});
        if (!root) {
          running = false;
          return;
        }
        if (auth.code !== 0 || !auth.data) {
          setStatus(`获取二维码失败：${auth.code} ${auth.message || ""}`);
          running = false;
          return;
        }
        const { url, auth_code } = auth.data;
        renderQR(url);
        const started = Date.now();
        let polling = false;
        let failStreak = 0;
        pollTimer = setInterval(async () => {
          if (!root) {
            closeOverlay();
            return;
          }
          if (Date.now() - started > 18e4) {
            setStatus("二维码已过期，请重新登录");
            closeOverlay();
            return;
          }
          if (polling) return;
          polling = true;
          try {
            const poll = await postSigned("/x/passport-tv-login/qrcode/poll", { auth_code });
            failStreak = 0;
            if (poll.code === 0 && poll.data && poll.data.access_token) {
              const t = pollTimer;
              pollTimer = null;
              if (t) clearInterval(t);
              running = false;
              onSuccess(poll.data.access_token);
              setStatus("登录成功，即将刷新…");
              setTimeout(() => {
                resetOverlayDom();
                location.reload();
              }, 1e3);
            } else if (poll.code === 86038) {
              setStatus("二维码已失效，请重新登录");
              closeOverlay();
            } else if (poll.code === 86090) {
              setStatus("已扫码，请在手机上确认");
            } else if (poll.code === 86039) {
            } else {
              setStatus(`登录失败：${poll.code} ${poll.message || ""}`);
              closeOverlay();
            }
          } catch (_) {
            if (++failStreak >= 5) {
              setStatus("网络或风控异常，请稍后重试");
              closeOverlay();
            }
          } finally {
            polling = false;
          }
        }, 2e3);
      } catch (e) {
        setStatus("登录出错：" + e.message);
        running = false;
      }
    })();
  }
  const PANEL_ID = "bilikit-panel-root";
  const FEED_ID = "__feed__";
  const OPEN_ID = "__open__";
  const PREVIEW_ID = "__preview__";
  const FEED_CAT = "推荐";
  let selected = "";
  let navEl = null;
  let detailEl = null;
  let footEl = null;
  const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, "PingFang SC", sans-serif; }

.gear {
  position: fixed; left: 18px; bottom: 26px; z-index: 2147483500;
  width: 38px; height: 38px; border-radius: 50%; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border: 1px solid rgba(255,255,255,.1); background: rgba(22,23,28,.9); color: #fff;
  box-shadow: 0 3px 14px rgba(0,0,0,.3); opacity: .45;
  transition: opacity .16s ease, transform .16s ease;
  -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px);
}
.gear:hover { opacity: 1; transform: translateY(-1px) rotate(30deg); }
.gear:active { transform: scale(.94); }
.gear svg { width: 20px; height: 20px; display: block; }

.overlay {
  position: fixed; inset: 0; z-index: 2147483501; background: rgba(0,0,0,.5);
  display: flex; align-items: center; justify-content: center;
  opacity: 0; visibility: hidden; transition: opacity .2s ease, visibility 0s linear .2s;
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
}
.overlay.open { opacity: 1; visibility: visible; transition: opacity .2s ease; }

.card {
  width: min(660px, calc(100vw - 32px)); height: 560px; max-height: 90vh;
  display: flex; flex-direction: column;
  background: #1c1d22; color: #e3e5e7; border-radius: 18px;
  box-shadow: 0 16px 56px rgba(0,0,0,.5); overflow: hidden;
  transform: translateY(10px) scale(.98); transition: transform .2s ease;
}
.overlay.open .card { transform: none; }

.head { display: flex; align-items: baseline; gap: 10px; padding: 18px 22px 14px; border-bottom: 1px solid rgba(255,255,255,.06); flex: 0 0 auto; }
.head .title { font-size: 17px; font-weight: 600; letter-spacing: .2px; }
.head .brand { color: #fb7299; }
.head .close { margin-left: auto; cursor: pointer; width: 30px; height: 30px; border-radius: 50%; border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05); color: rgba(255,255,255,.7); font-size: 18px; line-height: 1; display: flex; align-items: center; justify-content: center; transition: color .16s ease, border-color .16s ease, transform .12s ease; }
.head .close:hover { color: #fb7299; border-color: #fb7299; }
.head .close:active { transform: scale(.92); }

.main { flex: 1; display: flex; min-height: 0; }
.nav { width: 228px; flex: 0 0 auto; border-right: 1px solid rgba(255,255,255,.06); overflow: auto; padding: 12px 10px; }
.nav-cat { font-size: 12px; letter-spacing: .3px; color: rgba(255,255,255,.35); padding: 12px 8px 5px; }
.nav-cat:first-child { padding-top: 4px; }
.nav-item { display: flex; align-items: center; gap: 8px; padding: 9px 9px; border-radius: 9px; cursor: pointer; }
.nav-item:hover { background: rgba(255,255,255,.05); }
.nav-item.sel { background: rgba(251,114,153,.16); }
.nm-wrap { flex: 1; min-width: 0; display: flex; align-items: center; gap: 5px; }
.nav-item .nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; color: rgba(255,255,255,.85); }
.nav-item.sel .nm { color: #fb7299; font-weight: 500; }
.gear-ico { flex: 0 0 auto; width: 13px; height: 13px; color: rgba(255,255,255,.38); display: flex; }
.gear-ico svg { width: 13px; height: 13px; display: block; }
.nav-item:hover .gear-ico, .nav-item.sel .gear-ico { color: #fb7299; }

.detail { flex: 1; min-width: 0; overflow: auto; padding: 26px; display: flex; flex-direction: column; }
.detail-title { font-size: 19px; font-weight: 600; }
.detail-desc { font-size: 14px; color: rgba(255,255,255,.5); margin-top: 7px; line-height: 1.55; }
.fields { margin-top: 22px; display: flex; flex-direction: column; gap: 18px; }
.field { display: flex; flex-direction: column; gap: 8px; }
.field.row { flex-direction: row; align-items: center; justify-content: space-between; gap: 14px; }
.field.row .flabel { flex: 1; }
/* 开关行：标签+开关一行（space-between），hint 由 .field 的列布局落到下一行，避免三者挤成一排 */
.field .toggle-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.field .toggle-head .flabel { flex: 1; }
.field .flabel { font-size: 14px; color: rgba(255,255,255,.8); line-height: 1.4; }
.field .hint { font-size: 13px; color: rgba(255,255,255,.4); line-height: 1.45; }
.field input[type=text], .field textarea, .field select {
  width: 100%; background: rgba(255,255,255,.06); color: #e3e5e7;
  border: 1px solid rgba(255,255,255,.14); border-radius: 9px; padding: 9px 12px;
  font-size: 14px; font-family: inherit; outline: none;
}
.field input[type=text]:focus, .field textarea:focus, .field select:focus { border-color: #fb7299; }
.field textarea { min-height: 72px; resize: vertical; line-height: 1.5; }

.empty { margin: auto; text-align: center; color: rgba(255,255,255,.3); font-size: 14px; padding: 24px; }
.empty .ei { font-size: 30px; opacity: .5; margin-bottom: 8px; }
.empty .es { margin-top: 3px; font-size: 13px; }

.sw { position: relative; flex: 0 0 auto; width: 44px; height: 24px; }
.sw.sm { width: 34px; height: 19px; }
.sw input { position: absolute; opacity: 0; width: 100%; height: 100%; margin: 0; cursor: pointer; z-index: 1; }
.sw .track { position: absolute; inset: 0; border-radius: 24px; background: rgba(255,255,255,.16); transition: background .16s ease; }
.sw .track::after { content: ''; position: absolute; top: 2px; left: 2px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: transform .16s ease; box-shadow: 0 1px 3px rgba(0,0,0,.3); }
.sw.sm .track::after { width: 15px; height: 15px; }
.sw input:checked + .track { background: #fb7299; }
.sw input:checked + .track::after { transform: translateX(20px); }
.sw.sm input:checked + .track::after { transform: translateX(15px); }

/* 提示块：淡底圆角 + 图标，取代浮着的灰字。info 常规 / warn 品牌色调 */
.callout { display: flex; gap: 9px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: rgba(255,255,255,.055); font-size: 12.5px; line-height: 1.5; color: rgba(255,255,255,.62); }
.callout .ci { flex: 0 0 auto; margin-top: 1px; opacity: .85; }
.callout .ci svg { display: block; width: 14px; height: 14px; }
.callout a { color: #fb7299; text-decoration: none; font-weight: 500; }
.callout a:hover { text-decoration: underline; }
.callout.warn { background: rgba(251,114,153,.13); color: rgba(255,255,255,.82); }
.callout.warn .ci { color: #fb7299; opacity: 1; }
/* 状态徽章：带色点的 pill */
.status { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; padding: 5px 12px; border-radius: 20px; background: rgba(255,255,255,.07); color: rgba(255,255,255,.6); }
.status .dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.35); flex: 0 0 auto; }
.status.on { background: rgba(251,114,153,.15); color: #fb7299; }
.status.on .dot { background: #fb7299; box-shadow: 0 0 0 3px rgba(251,114,153,.2); }
.feed-btn { align-self: flex-start; cursor: pointer; color: #fff; background: #fb7299; border: none; border-radius: 9px; padding: 9px 18px; font-size: 14px; font-family: inherit; font-weight: 500; }
.feed-btn.ghost { background: transparent; border: 1px solid rgba(255,255,255,.2); color: #e3e5e7; }
.feed-btn:hover { filter: brightness(1.08); }

.foot { padding: 12px 22px 15px; font-size: 12px; color: rgba(255,255,255,.4); display: flex; align-items: center; gap: 12px; border-top: 1px solid rgba(255,255,255,.06); flex: 0 0 auto; }
.foot .legend { margin-left: auto; display: flex; align-items: center; gap: 5px; }
.foot .legend .gear-ico { width: 12px; height: 12px; color: #fb7299; }
.foot .legend .gear-ico svg { width: 12px; height: 12px; }
.reload { display: none; cursor: pointer; color: #fff; background: #fb7299; border: none; border-radius: 9px; padding: 6px 14px; font-size: 12px; font-family: inherit; font-weight: 500; }
.foot.dirty .reload { display: inline-block; }
.foot.dirty .note { color: #fb7299; }

@media (prefers-color-scheme: light) {
  .gear { background: rgba(255,255,255,.95); color: #18191c; border-color: rgba(0,0,0,.08); box-shadow: 0 3px 14px rgba(0,0,0,.14); }
  .card { background: #fff; color: #18191c; box-shadow: 0 16px 56px rgba(0,0,0,.22); }
  .head { border-bottom-color: rgba(0,0,0,.07); }
  .head .brand { color: #d6336c; }
  .head .close { border-color: rgba(0,0,0,.12); background: rgba(0,0,0,.04); color: rgba(0,0,0,.55); }
  .head .close:hover { color: #d6336c; border-color: #d6336c; }
  .main .nav { border-right-color: rgba(0,0,0,.07); }
  .nav-cat { color: rgba(0,0,0,.4); }
  .nav-item:hover { background: rgba(0,0,0,.05); }
  .nav-item.sel { background: rgba(214,51,108,.12); }
  .nav-item .nm { color: rgba(0,0,0,.82); }
  .nav-item.sel .nm { color: #d6336c; }
  .nav-item:hover .gear-ico, .nav-item.sel .gear-ico, .foot .legend .gear-ico { color: #d6336c; }
  .detail-desc { color: rgba(0,0,0,.5); }
  .field .flabel { color: rgba(0,0,0,.75); }
  .field .hint { color: rgba(0,0,0,.42); }
  .field input[type=text], .field textarea, .field select { background: rgba(0,0,0,.04); color: #18191c; border-color: rgba(0,0,0,.14); }
  .field input[type=text]:focus, .field textarea:focus, .field select:focus { border-color: #d6336c; }
  .empty { color: rgba(0,0,0,.35); }
  .sw .track { background: rgba(0,0,0,.16); }
  .sw input:checked + .track { background: #d6336c; }
  .callout { background: rgba(0,0,0,.04); color: rgba(0,0,0,.6); }
  .callout.warn { background: rgba(214,51,108,.1); color: rgba(0,0,0,.75); }
  .callout.warn .ci { color: #d6336c; }
  .callout a { color: #d6336c; }
  .status { background: rgba(0,0,0,.05); color: rgba(0,0,0,.55); }
  .status .dot { background: rgba(0,0,0,.3); }
  .status.on { background: rgba(214,51,108,.12); color: #d6336c; }
  .status.on .dot { background: #d6336c; box-shadow: 0 0 0 3px rgba(214,51,108,.18); }
  .feed-btn { background: #d6336c; }
  .feed-btn.ghost { border-color: rgba(0,0,0,.2); color: #18191c; }
  .foot { color: rgba(0,0,0,.45); border-top-color: rgba(0,0,0,.07); }
  .reload { background: #d6336c; }
  .foot.dirty .note { color: #d6336c; }
}
`;
  const GEAR_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const INFO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  const WARN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
  function callout(html, variant = "info") {
    const c = el("div", "callout" + (variant === "warn" ? " warn" : ""));
    c.innerHTML = `<span class="ci">${variant === "warn" ? WARN_SVG : INFO_SVG}</span><span class="ctext">${html}</span>`;
    return c;
  }
  function markDirty() {
    if (footEl) footEl.classList.add("dirty");
  }
  function switchEl(checked, onChange, small = false) {
    const sw = el("span", "sw" + (small ? " sm" : ""));
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = checked;
    const track = el("span", "track");
    inp.addEventListener("change", () => onChange(inp.checked));
    sw.append(inp, track);
    return sw;
  }
  function renderField(m, f) {
    const wrap = el("div");
    const cur = getField(m, f.key);
    if (f.type === "toggle") {
      wrap.className = "field";
      const head = el("div", "toggle-head");
      const lab = el("span", "flabel", f.label);
      const sw = switchEl(!!cur, (on) => {
        setField(m.id, f.key, on);
        markDirty();
      });
      head.append(lab, sw);
      wrap.append(head);
    } else if (f.type === "select") {
      wrap.className = "field";
      wrap.appendChild(el("span", "flabel", f.label));
      const sel = document.createElement("select");
      const presets = f.options.map((o) => o.value);
      for (const o of f.options) {
        const opt = document.createElement("option");
        opt.value = o.value;
        opt.textContent = o.label;
        sel.appendChild(opt);
      }
      const CUSTOM = "__custom__";
      let input = null;
      if (f.allowCustom) {
        const opt = document.createElement("option");
        opt.value = CUSTOM;
        opt.textContent = "自定义…";
        sel.appendChild(opt);
        input = document.createElement("input");
        input.type = "text";
        if (f.customPlaceholder) input.placeholder = f.customPlaceholder;
        input.addEventListener("input", () => {
          setField(m.id, f.key, input.value);
          markDirty();
        });
      }
      const isPreset = presets.includes(cur);
      if (f.allowCustom && !isPreset && cur) {
        sel.value = CUSTOM;
        input.value = String(cur);
        input.style.display = "";
      } else {
        const useDefault = !isPreset;
        sel.value = useDefault ? f.default : String(cur);
        if (useDefault && String(cur) !== f.default) setField(m.id, f.key, f.default);
        if (input) input.style.display = "none";
      }
      sel.addEventListener("change", () => {
        if (sel.value === CUSTOM && input) {
          input.style.display = "";
          setField(m.id, f.key, input.value);
          input.focus();
        } else {
          if (input) input.style.display = "none";
          setField(m.id, f.key, sel.value);
        }
        markDirty();
      });
      wrap.appendChild(sel);
      if (input) wrap.appendChild(input);
    } else if (f.type === "textarea") {
      wrap.className = "field";
      wrap.appendChild(el("span", "flabel", f.label));
      const ta = document.createElement("textarea");
      ta.value = String(cur ?? "");
      if (f.placeholder) ta.placeholder = f.placeholder;
      ta.addEventListener("change", () => {
        setField(m.id, f.key, ta.value);
        markDirty();
      });
      wrap.appendChild(ta);
    } else {
      wrap.className = "field";
      wrap.appendChild(el("span", "flabel", f.label));
      const inp = document.createElement("input");
      inp.type = "text";
      inp.value = String(cur ?? "");
      if (f.placeholder) inp.placeholder = f.placeholder;
      inp.addEventListener("change", () => {
        setField(m.id, f.key, inp.value);
        markDirty();
      });
      wrap.appendChild(inp);
    }
    if (f.hint) wrap.appendChild(el("div", "hint", f.hint));
    return wrap;
  }
  function emptyState(main, sub) {
    const e = el("div", "empty");
    e.appendChild(el("div", "ei", "◔"));
    e.appendChild(el("div", null, main));
    if (sub) e.appendChild(el("div", "es", sub));
    return e;
  }
  function navItemModule(m) {
    const row = el("div", "nav-item" + (selected === m.id ? " sel" : ""));
    const wrap = el("div", "nm-wrap");
    wrap.appendChild(el("span", "nm", m.name));
    if (m.settings && m.settings.length) {
      const g = el("span", "gear-ico");
      g.innerHTML = GEAR_SVG;
      wrap.appendChild(g);
    }
    row.appendChild(wrap);
    const sw = switchEl(isModuleEnabled(m), (on) => {
      setModuleEnabled(m.id, on);
      markDirty();
    }, true);
    sw.addEventListener("click", (e) => e.stopPropagation());
    row.appendChild(sw);
    row.addEventListener("click", () => select(m.id));
    return row;
  }
  function navItemSpecial(id, name) {
    const row = el("div", "nav-item" + (selected === id ? " sel" : ""));
    const wrap = el("div", "nm-wrap");
    wrap.appendChild(el("span", "nm", name));
    const g = el("span", "gear-ico");
    g.innerHTML = GEAR_SVG;
    wrap.appendChild(g);
    row.appendChild(wrap);
    row.addEventListener("click", () => select(id));
    return row;
  }
  function renderNav() {
    if (!navEl) return;
    navEl.textContent = "";
    const cats = [];
    const byCat = /* @__PURE__ */ new Map();
    for (const m of getModules()) {
      const c = m.category || "其它";
      if (!byCat.has(c)) {
        byCat.set(c, []);
        cats.push(c);
      }
      byCat.get(c).push(m);
    }
    if (!cats.includes(FEED_CAT)) cats.push(FEED_CAT);
    for (const c of cats) {
      navEl.appendChild(el("div", "nav-cat", c));
      for (const m of byCat.get(c) || []) navEl.appendChild(navItemModule(m));
      if (c === "播放") navEl.appendChild(navItemSpecial(OPEN_ID, "打开方式"));
      if (c === FEED_CAT) {
        navEl.appendChild(navItemSpecial(FEED_ID, "App 推荐 Feed"));
        navEl.appendChild(navItemSpecial(PREVIEW_ID, "封面预览"));
      }
    }
  }
  function renderFeedDetail(d) {
    const loggedIn = !!get("feed.accessKey", "");
    d.appendChild(el("div", "detail-title", "App 推荐 Feed"));
    d.appendChild(el("div", "detail-desc", "首页换成手机 App 的推荐流（需另装 BiliKit Feed 脚本）"));
    const onHome = location.pathname === "/" || location.pathname === "/index.html";
    const feedAlive = Number(localStorage.getItem("bilikit:alive.feed") || 0);
    if (onHome && Date.now() - feedAlive > 8e3) {
      d.appendChild(callout('未检测到 <b>BiliKit Feed</b>，首页推荐流需要它。<a href="https://github.com/shiinayane/BiliKit" target="_blank" rel="noopener">前往安装</a>', "warn"));
    }
    const fields = el("div", "fields");
    const row = el("div", "field row");
    row.appendChild(el("span", "flabel", "登录状态"));
    const st = el("span", "status" + (loggedIn ? " on" : ""));
    const setStatus2 = (t) => {
      st.innerHTML = `<span class="dot"></span>${t}`;
    };
    setStatus2(loggedIn ? "已登录 · 个性化推荐" : "未登录 · 匿名（内容有限）");
    row.appendChild(st);
    fields.appendChild(row);
    const btn = el("button", "feed-btn" + (loggedIn ? " ghost" : ""), loggedIn ? "退出登录" : "扫码登录（TV）");
    btn.addEventListener("click", () => {
      if (loggedIn) {
        set("feed.accessKey", "");
        location.reload();
      } else {
        setStatus2("正在拉起二维码…");
        startTvLogin((accessKey) => {
          if (!set("feed.accessKey", accessKey)) console.error("[BiliKit] access_key 持久化失败：刷新后可能仍为匿名（浏览器隐私模式或存储已满）。");
        });
      }
    });
    fields.appendChild(btn);
    fields.appendChild(callout(loggedIn ? "退出后回到匿名推荐并刷新。" : "用手机哔哩哔哩扫码，获得个性化、不重复的 App 推荐。"));
    d.appendChild(fields);
  }
  function renderOpenDetail(d) {
    d.appendChild(el("div", "detail-title", "打开方式"));
    d.appendChild(el("div", "detail-desc", "全站（首页 / 搜索 / 收藏 / 历史 / 空间…）点视频时如何打开"));
    const fields = el("div", "fields");
    const modeRow = el("div", "field");
    modeRow.appendChild(el("span", "flabel", "视频打开方式"));
    const modeSel = document.createElement("select");
    for (const [val, label] of [["drawer", "抽屉"], ["drawer-web", "抽屉 · 网页全屏"], ["newtab", "新标签页"], ["current", "当前页"]]) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = label;
      modeSel.appendChild(o);
    }
    modeSel.value = get("feed.openMode", "drawer");
    modeRow.appendChild(modeSel);
    fields.appendChild(modeRow);
    const immRow = el("div", "field");
    const immHead = el("div", "toggle-head");
    immHead.append(el("span", "flabel", "隐藏切换过程"), switchEl(get("feed.drawerImmersive", true), (on) => set("feed.drawerImmersive", on)));
    immRow.append(immHead, el("div", "hint", "开：等播放器铺满后再显示，看不到从普通页切到全屏的过程（加载稍久一点）。关：先显示、再当场铺满，会瞥见这下切换。"));
    fields.appendChild(immRow);
    const syncImm = () => {
      immRow.style.display = modeSel.value === "drawer-web" ? "" : "none";
    };
    syncImm();
    modeSel.addEventListener("change", () => {
      set("feed.openMode", modeSel.value);
      syncImm();
    });
    fields.appendChild(callout("全站生效（搜索 / 收藏 / 历史 / 空间等页面点视频，就地开抽屉、不丢当前列表）。<br><b>抽屉</b>：视频从底部滑出、内嵌整页播放，弹幕评论都在，点缝 / 关闭键 / Esc 关闭。<br><b>抽屉 · 网页全屏</b>：同样的抽屉，但播放器自动铺满、只看视频，更沉浸。<br><b>新标签页 / 当前页</b>：跳转到视频页打开（当前页=不拦、走原生）。"));
    d.appendChild(fields);
  }
  function renderPreviewDetail(d) {
    d.appendChild(el("div", "detail-title", "封面预览"));
    d.appendChild(el("div", "detail-desc", "鼠标悬停封面时的预览方式"));
    const fields = el("div", "fields");
    const row = el("div", "field");
    row.appendChild(el("span", "flabel", "预览方式"));
    const sel = document.createElement("select");
    for (const [val, label] of [["video", "真视频"], ["sprite", "雪碧图"], ["off", "关闭"]]) {
      const o = document.createElement("option");
      o.value = val;
      o.textContent = label;
      sel.appendChild(o);
    }
    sel.value = get("feed.previewMode", "video");
    sel.addEventListener("change", () => {
      set("feed.previewMode", sel.value);
      markDirty();
    });
    row.appendChild(sel);
    fields.appendChild(row);
    fields.appendChild(callout("<b>真视频</b>：悬停即拉低清视频、静音自动播，最接近手机 App 的秒开（比雪碧图费流量）。<br><b>雪碧图</b>：只拉缩略帧轮播，省流量、更轻。<br><b>关闭</b>：悬停不预览。"));
    d.appendChild(fields);
  }
  function renderDetail() {
    if (!detailEl) return;
    detailEl.textContent = "";
    if (selected === FEED_ID) {
      renderFeedDetail(detailEl);
      return;
    }
    if (selected === OPEN_ID) {
      renderOpenDetail(detailEl);
      return;
    }
    if (selected === PREVIEW_ID) {
      renderPreviewDetail(detailEl);
      return;
    }
    const m = getModules().find((x) => x.id === selected);
    if (!m) {
      detailEl.appendChild(emptyState("选择左侧一项"));
      return;
    }
    detailEl.appendChild(el("div", "detail-title", m.name));
    if (m.description) detailEl.appendChild(el("div", "detail-desc", m.description));
    const hasSettings = !!(m.settings && m.settings.length);
    if (hasSettings || m.note) {
      const fields = el("div", "fields");
      if (m.note) fields.appendChild(callout(m.note));
      if (m.settings) for (const f of m.settings) fields.appendChild(renderField(m, f));
      detailEl.appendChild(fields);
    } else {
      detailEl.appendChild(emptyState("此模块无额外配置", "开关在左侧列表"));
    }
  }
  function firstNavId() {
    const ms = getModules();
    return ms.length ? ms[0].id : FEED_ID;
  }
  function select(id) {
    selected = id;
    renderNav();
    renderDetail();
  }
  function mountPanel() {
    if (window.top !== window.self) return;
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", mountPanel, { once: true });
      return;
    }
    if (document.getElementById(PANEL_ID)) return;
    const root2 = el("div");
    root2.id = PANEL_ID;
    const sr = root2.attachShadow({ mode: "open" });
    sr.innerHTML = `<style>${STYLE}</style>`;
    const gear = el("div", "gear");
    gear.title = "BiliKit 设置";
    gear.innerHTML = GEAR_SVG;
    const overlay = el("div", "overlay");
    const card = el("div", "card");
    const head = el("div", "head");
    head.innerHTML = `<span class="title"><span class="brand">BiliKit</span> 设置</span>`;
    const close = el("span", "close", "×");
    head.appendChild(close);
    const main = el("div", "main");
    navEl = el("div", "nav");
    detailEl = el("div", "detail");
    main.append(navEl, detailEl);
    footEl = el("div", "foot");
    const note = el("span", "note", "改动需刷新页面生效");
    const reload = el("button", "reload", "刷新");
    reload.addEventListener("click", () => location.reload());
    const legend = el("div", "legend");
    const lg = el("span", "gear-ico");
    lg.innerHTML = GEAR_SVG;
    legend.append(lg, el("span", null, "有可调项"));
    footEl.append(note, reload, legend);
    card.append(head, main, footEl);
    overlay.appendChild(card);
    const open = () => {
      if (!selected || selected !== FEED_ID && selected !== OPEN_ID && selected !== PREVIEW_ID && !getModules().some((m) => m.id === selected)) selected = firstNavId();
      renderNav();
      renderDetail();
      overlay.classList.add("open");
    };
    const closePanel = () => overlay.classList.remove("open");
    gear.addEventListener("click", open);
    close.addEventListener("click", closePanel);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closePanel();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closePanel();
    });
    sr.append(gear, overlay);
    document.body.appendChild(root2);
  }
  function init$5(cfg) {
    if (window.__BILIKIT_CDN_PICK__) return;
    window.__BILIKIT_CDN_PICK__ = true;
    const TARGET_HOST = cfg.get("targetHost");
    const BACKUP_HOSTS = ["upos-sz-upcdnbda2.bilivideo.com", "upos-sz-mirrorhw.bilivideo.com"];
    const log = (...a) => {
    };
    if (!TARGET_HOST) {
      return;
    }
    const UPOS_RE = /^(?:https?:)?\/\/[^/]*\.(?:bilivideo\.com|acgvideo\.(?:com|cn))\//;
    const isUpos = (u) => typeof u === "string" && UPOS_RE.test(u);
    const swapHost = (u, host) => u.replace(/^(?:https?:)?\/\/[^/]+\//, `https://${host}/`);
    function fixEntry(e) {
      if (!e || typeof e !== "object") return false;
      const cands = [];
      for (const k of ["baseUrl", "base_url", "url"]) if (typeof e[k] === "string") cands.push(e[k]);
      for (const k of ["backupUrl", "backup_url"]) if (Array.isArray(e[k])) cands.push(...e[k].filter((x) => typeof x === "string"));
      const upos = cands.find(isUpos);
      if (!upos) return false;
      const primary = swapHost(upos, TARGET_HOST);
      const backups = BACKUP_HOSTS.map((h) => swapHost(upos, h));
      for (const k of ["baseUrl", "base_url", "url"]) if (typeof e[k] === "string") e[k] = primary;
      if (Array.isArray(e.backupUrl)) e.backupUrl = [primary, ...backups];
      if (Array.isArray(e.backup_url)) e.backup_url = [primary, ...backups];
      return true;
    }
    function rewritePlayurl(root2) {
      if (!root2 || typeof root2 !== "object") return false;
      if (root2.code !== void 0 && root2.code !== 0) return false;
      const d = root2.data || root2.result || root2;
      if (!d || typeof d !== "object") return false;
      let hit = false;
      const dash = d.dash;
      if (dash) {
        for (const list of [dash.video, dash.audio, dash.dolby && dash.dolby.audio]) {
          if (Array.isArray(list)) list.forEach((e) => {
            if (fixEntry(e)) hit = true;
          });
        }
        if (dash.flac && dash.flac.audio && fixEntry(dash.flac.audio)) hit = true;
      }
      if (Array.isArray(d.durl)) d.durl.forEach((e) => {
        if (fixEntry(e)) hit = true;
      });
      return hit;
    }
    const PLAYURL_PATHS = [
      "/x/player/wbi/playurl",
      "/x/player/playurl",
      "/pgc/player/web/playurl",
      "/pgc/player/web/v2/playurl",
      "/pgc/player/api/playurl",
      "/pugv/player/web/playurl"
    ];
    const isPlayurl = (u) => typeof u === "string" && PLAYURL_PATHS.some((p) => u.includes(p));
    let playinfo;
    try {
      Object.defineProperty(window, "__playinfo__", {
        configurable: true,
        get: () => playinfo,
        set: (v) => {
          try {
            if (rewritePlayurl(v)) log("__playinfo__ 改写", TARGET_HOST);
          } catch (_) {
          }
          playinfo = v;
        }
      });
    } catch (_) {
    }
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = async function(input, init2) {
        const url = typeof input === "string" ? input : input && input.url || String(input || "");
        const resp = await origFetch.apply(this, arguments);
        if (!isPlayurl(url)) return resp;
        try {
          const text = await resp.clone().text();
          const obj = JSON.parse(text);
          if (rewritePlayurl(obj)) {
            log("fetch playurl 改写", TARGET_HOST);
            const headers = new Headers(resp.headers);
            headers.delete("content-length");
            headers.delete("content-encoding");
            return new Response(JSON.stringify(obj), { status: resp.status, statusText: resp.statusText, headers });
          }
        } catch (_) {
        }
        return resp;
      };
    }
    const OX = window.XMLHttpRequest;
    if (OX) {
      class X extends OX {
        open(method, url) {
          this.__cdnUrl = url;
          return super.open.apply(this, arguments);
        }
        get responseText() {
          const rt = this.responseType;
          if (rt !== "" && rt !== "text") return super.responseText;
          return this.__cdnText(super.responseText);
        }
        get response() {
          const r = super.response;
          if (this.readyState !== 4 || !isPlayurl(this.__cdnUrl)) return r;
          if (typeof r === "string") return this.__cdnText(r);
          if (r && typeof r === "object") {
            try {
              if (rewritePlayurl(r)) log("xhr(json) playurl 改写", TARGET_HOST);
            } catch (_) {
            }
          }
          return r;
        }
        __cdnText(raw) {
          if (this.readyState !== 4 || typeof raw !== "string" || !isPlayurl(this.__cdnUrl)) return raw;
          try {
            const obj = JSON.parse(raw);
            if (rewritePlayurl(obj)) {
              log("xhr playurl 改写", TARGET_HOST);
              return JSON.stringify(obj);
            }
          } catch (_) {
          }
          return raw;
        }
      }
      window.XMLHttpRequest = X;
    }
  }
  const cdnPick = {
    id: "cdn-pick",
    name: "CDN 优选",
    description: "视频分片重定向到更快的大陆镜像",
    category: "播放",
    runAt: "start",
    settings: [
      {
        key: "targetHost",
        type: "select",
        label: "CDN 镜像节点",
        default: "upos-sz-mirrorhwb.bilivideo.com",
        options: [
          { label: "华为 hwb（日本实测首选）", value: "upos-sz-mirrorhwb.bilivideo.com" },
          { label: "百度 bda2（地板最高）", value: "upos-sz-upcdnbda2.bilivideo.com" },
          { label: "华为 hw", value: "upos-sz-mirrorhw.bilivideo.com" },
          { label: "阿里 alib", value: "upos-sz-mirroralib.bilivideo.com" },
          { label: "阿里 ali", value: "upos-sz-mirrorali.bilivideo.com" },
          { label: "腾讯 cos", value: "upos-sz-mirrorcos.bilivideo.com" },
          { label: "腾讯 cosb", value: "upos-sz-mirrorcosb.bilivideo.com" },
          { label: "网宿 ws", value: "upos-sz-upcdnws.bilivideo.com" },
          { label: "关闭（用 B 站默认分配）", value: "" }
        ],
        allowCustom: true,
        customPlaceholder: "upos-sz-mirrorXXX.bilivideo.com",
        hint: "把视频分片钉到该大陆镜像，绕开慢节点；选「自定义…」可手填镜像主机（须 upos 系 .bilivideo.com，否则会 403）"
      }
    ],
    init: init$5
  };
  function init$4(cfg) {
    if (window.__BILIKIT_NO_TRACK__) return;
    window.__BILIKIT_NO_TRACK__ = true;
    const TELEMETRY = [
      "data.bilibili.com/log",
      "api.bilibili.com/x/click-interface/click",
      "mcbas.",
      "webase"
    ];
    const ADS = ["cm.bilibili.com"];
    const parseCustom = (s) => (s || "").split("\n").map((x) => x.trim()).filter(Boolean);
    let adsOn = cfg.get("blockAds") !== false;
    let custom = parseCustom(cfg.get("custom"));
    try {
      window.addEventListener(SETTINGS_EVENT, () => {
        adsOn = cfg.get("blockAds") !== false;
        custom = parseCustom(cfg.get("custom"));
      });
    } catch (_) {
    }
    let blocked = 0;
    const stats = () => ({ blocked });
    window.__BILIKIT_NOTRACK_STATS__ = stats;
    function isBlocked(input) {
      let u;
      if (typeof input === "string") u = input;
      else if (input && typeof input.url === "string") u = input.url;
      else {
        try {
          u = String(input);
        } catch (_) {
          return false;
        }
      }
      if (!u) return false;
      for (const p of TELEMETRY) if (u.includes(p)) return true;
      if (adsOn) {
        for (const p of ADS) if (u.includes(p)) return true;
      }
      for (const p of custom) if (u.includes(p)) return true;
      return false;
    }
    function hit(u) {
      blocked++;
    }
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = function(input, init2) {
        if (isBlocked(input)) {
          hit();
          return Promise.resolve(new Response(null, { status: 204, statusText: "No Content" }));
        }
        return origFetch.apply(this, arguments);
      };
    }
    if (navigator.sendBeacon) {
      const origSB = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = function(url, data) {
        if (isBlocked(url)) {
          hit();
          return true;
        }
        return origSB(url, data);
      };
    }
    const OX = window.XMLHttpRequest;
    if (OX) {
      class X extends OX {
        constructor() {
          super(...arguments);
          this.__ntBlocked = false;
          this.__ntUrl = "";
        }
        open(method, url, ...rest) {
          this.__ntUrl = url;
          this.__ntBlocked = isBlocked(url);
          return super.open(method, url, ...rest);
        }
        send(body) {
          if (this.__ntBlocked) {
            hit(this.__ntUrl);
            return;
          }
          return super.send(body);
        }
      }
      window.XMLHttpRequest = X;
    }
  }
  const noTrack = {
    id: "no-track",
    name: "埋点拦截",
    description: "拦掉行为遥测与广告请求，省流量、降开销",
    category: "性能",
    runAt: "start",
    settings: [
      {
        key: "blockAds",
        type: "toggle",
        label: "同时拦广告投放",
        default: true,
        hint: "额外拦截 cm.bilibili.com 广告内容/计费请求；关掉则只拦纯遥测日志（data.bilibili.com 等）"
      },
      {
        key: "custom",
        type: "textarea",
        label: "额外拦截（每行一个网址片段）",
        default: "",
        placeholder: "例如 example.com/track",
        hint: "请求 URL 含其中任一片段即拦；留空不额外拦"
      }
    ],
    init: init$4
  };
  function init$3(cfg) {
    if (window.top !== window.self && !location.hash.includes("bk-drawer")) return;
    if (window.__BILIKIT_THEME_SYNC__) return;
    window.__BILIKIT_THEME_SYNC__ = true;
    const COOKIE_NAME = "theme_style";
    const COOKIE_DOMAIN = ".bilibili.com";
    const THEME_LINK_RE = /\/bili-theme\/(light|dark)\.css/;
    const mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const systemDark = () => !!(mql && mql.matches);
    const wantDark = () => {
      const mode = cfg.get("mode") || "auto";
      if (mode === "dark") return true;
      if (mode === "light") return false;
      return systemDark();
    };
    function readCookie2(name) {
      const m = document.cookie.match(new RegExp("(?:^|;\\s*)" + name + "=([^;]*)"));
      return m ? m[1] : null;
    }
    function setCookie(name, value) {
      if (readCookie2(name) === value) return;
      document.cookie = `${name}=${value}; path=/; domain=${COOKIE_DOMAIN}; max-age=31536000; SameSite=Lax`;
    }
    function swapThemeStylesheet(doc, dark) {
      const want = dark ? "/dark.css" : "/light.css";
      for (const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
        if (!THEME_LINK_RE.test(link.href)) continue;
        if (!link.href.includes(want)) link.href = link.href.replace(/\/(light|dark)\.css/, want);
      }
    }
    function syncComponentTheme(dark) {
      const want = dark ? "dark" : "light";
      for (const el2 of document.querySelectorAll("bili-comments")) {
        try {
          if (el2.theme !== want) el2.theme = want;
        } catch (_) {
        }
      }
    }
    function apply() {
      const dark = wantDark();
      setCookie(COOKIE_NAME, dark ? "dark" : "light");
      swapThemeStylesheet(document, dark);
      const root2 = document.documentElement;
      root2.classList.toggle("bili_dark", dark);
      root2.classList.toggle("night-mode", dark);
      root2.style.backgroundColor = dark ? "#18191c" : "";
      syncComponentTheme(dark);
    }
    apply();
    document.addEventListener("DOMContentLoaded", apply);
    if (mql) {
      if (typeof mql.addEventListener === "function") mql.addEventListener("change", apply);
      else if (typeof mql.addListener === "function") mql.addListener(apply);
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") apply();
    });
    window.addEventListener(SETTINGS_EVENT, apply);
    window.addEventListener("storage", (e) => {
      if (!e.key || e.key === "bilikit:settings") apply();
    });
    let syncPending = 0;
    const scheduleComponentSync = () => {
      if (syncPending) return;
      syncPending = requestAnimationFrame(() => {
        syncPending = 0;
        syncComponentTheme(wantDark());
      });
    };
    new MutationObserver(scheduleComponentSync).observe(document.documentElement, { childList: true, subtree: true });
  }
  const themeSync = {
    id: "theme-sync",
    name: "主题同步",
    description: "跟随系统深浅色，全站无刷新实时切换",
    category: "界面",
    runAt: "start",
    settings: [
      {
        key: "mode",
        type: "select",
        label: "主题模式",
        default: "auto",
        options: [
          { label: "跟随系统", value: "auto" },
          { label: "始终深色", value: "dark" },
          { label: "始终浅色", value: "light" }
        ],
        hint: "跟随系统深浅，或强制固定一种"
      }
    ],
    init: init$3
  };
  function init$2(cfg) {
    if (window.__BILIKIT_COMMENT_LOC__) return;
    window.__BILIKIT_COMMENT_LOC__ = true;
    const PIN = cfg.get("pin") || "";
    function resolveLocation(el2) {
      let n = el2, hop = 0;
      while (n && hop++ < 8) {
        for (const key of ["data", "reply", "_data"]) {
          const d = n[key];
          const loc = d && d.reply_control && d.reply_control.location;
          if (typeof loc === "string" && loc) return loc;
        }
        const root2 = n.getRootNode ? n.getRootNode() : null;
        n = root2 instanceof ShadowRoot ? root2.host : n.parentElement;
      }
      return null;
    }
    const format = (loc) => loc.replace(/^\s*IP属地[:：]\s*/, "");
    const observed = /* @__PURE__ */ new WeakSet();
    function observeRoot(sr) {
      if (observed.has(sr)) return;
      observed.add(sr);
      new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type !== "childList") continue;
          for (const n of m.addedNodes) {
            if (n.nodeType === 1 && !n.isContentEditable) {
              schedule();
              return;
            }
          }
        }
      }).observe(sr, { childList: true, subtree: true });
    }
    function walk(root2) {
      if (root2.localName === "bili-comment-action-buttons-renderer") inject(root2);
      let nodes;
      try {
        nodes = root2.querySelectorAll("*");
      } catch (_) {
        return;
      }
      for (const n of nodes) {
        if (n.localName === "bili-comment-action-buttons-renderer") inject(n);
        const sr = n.shadowRoot;
        if (sr) {
          observeRoot(sr);
          walk(sr);
        }
      }
    }
    let nativeGap = "";
    function blockGap(sr) {
      if (!nativeGap) {
        const sib = sr.querySelector("#like") || sr.querySelector("#reply") || sr.querySelector("#dislike");
        const m = sib ? getComputedStyle(sib).marginLeft : "";
        if (m && m !== "0px") nativeGap = m;
      }
      return nativeGap || "16px";
    }
    function inject(ab) {
      const sr = ab.shadowRoot;
      if (!sr || sr.querySelector(".bilikit-loc")) return false;
      const pubdate = sr.querySelector("#pubdate");
      if (!pubdate) return false;
      const loc = resolveLocation(ab);
      if (!loc) {
        return false;
      }
      const span = document.createElement("span");
      span.className = "bilikit-loc";
      span.textContent = PIN + format(loc);
      span.style.cssText = `margin-left:calc(${blockGap(sr)} / 2);color:var(--text3,#9499a0);font-size:inherit;white-space:nowrap;`;
      pubdate.after(span);
      return true;
    }
    let topRoot = null;
    let rafId = 0;
    function schedule() {
      if (rafId || !topRoot) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        walk(topRoot);
      });
    }
    function bind(comments) {
      const sr = comments.shadowRoot;
      if (!sr) return;
      topRoot = sr;
      observeRoot(sr);
      walk(sr);
    }
    let current = null;
    function tryBind() {
      const c = document.querySelector("#commentapp bili-comments");
      if (c && c !== current && c.shadowRoot) {
        current = c;
        bind(c);
      }
    }
    function watch(app2) {
      new MutationObserver(tryBind).observe(app2, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-params"]
      });
      tryBind();
    }
    const app = document.querySelector("#commentapp");
    if (app) {
      watch(app);
    } else {
      let tries = 0;
      const t = setInterval(() => {
        const a = document.querySelector("#commentapp");
        if (a) {
          clearInterval(t);
          watch(a);
        } else if (++tries > 40) clearInterval(t);
      }, 500);
    }
  }
  const commentLocation = {
    id: "comment-location",
    name: "评论属地",
    description: "评论/回复时间旁显示 IP 属地",
    category: "界面",
    runAt: "idle",
    settings: [
      { key: "pin", type: "text", label: "地名前缀符", default: "", placeholder: "如 📍 ", hint: "显示在属地前，默认无；想加自己填" }
    ],
    init: init$2
  };
  function init$1() {
    const nav = navigator;
    if (!("wakeLock" in navigator)) return;
    if (window.__BILIKIT_WAKE_LOCK__) return;
    window.__BILIKIT_WAKE_LOCK__ = true;
    const log = (...args) => {
    };
    let sentinel = null;
    let currentVideo = null;
    let retryTimer = null;
    let acquiring = false;
    async function requestWakeLock() {
      if (sentinel || acquiring) return;
      if (!currentVideo || currentVideo.paused) return;
      if (document.visibilityState !== "visible") return;
      acquiring = true;
      try {
        sentinel = await nav.wakeLock.request("screen");
        log("acquired");
        sentinel.addEventListener("release", () => {
          log("released");
          sentinel = null;
          if (currentVideo && !currentVideo.paused) retryWakeLock();
        });
        if (!currentVideo || currentVideo.paused || document.visibilityState !== "visible") {
          log("stale acquire, releasing");
          await sentinel.release();
        }
      } catch (err) {
        retryWakeLock();
      } finally {
        acquiring = false;
      }
    }
    function retryWakeLock() {
      if (retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        requestWakeLock();
      }, 2e3);
    }
    async function releaseWakeLock() {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      try {
        if (sentinel) {
          await sentinel.release();
          sentinel = null;
          log("manually released");
        }
      } catch {
      }
    }
    const onMediaStop = (e) => {
      if (e.target === currentVideo) releaseWakeLock();
    };
    const onEmptied = (e) => {
      const v = e.target;
      if (v !== currentVideo) return;
      setTimeout(() => {
        if (v === currentVideo && (v.paused || v.ended || !v.isConnected)) releaseWakeLock();
      }, 800);
    };
    function bindVideo(v) {
      if (currentVideo === v) return;
      if (currentVideo) {
        currentVideo.removeEventListener("pause", onMediaStop);
        currentVideo.removeEventListener("ended", onMediaStop);
        currentVideo.removeEventListener("emptied", onEmptied);
      }
      currentVideo = v;
      v.addEventListener("pause", onMediaStop);
      v.addEventListener("ended", onMediaStop);
      v.addEventListener("emptied", onEmptied);
    }
    document.addEventListener(
      "playing",
      (e) => {
        if (!(e.target instanceof HTMLVideoElement)) return;
        bindVideo(e.target);
        requestWakeLock();
      },
      true
    );
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && currentVideo && !currentVideo.paused) {
        requestWakeLock();
      }
    });
    const initial = document.querySelector("video");
    if (initial && !initial.paused) {
      bindVideo(initial);
      requestWakeLock();
    }
  }
  const wakeLock = {
    id: "wake-lock",
    name: "防睡眠",
    description: "播放视频时阻止 Safari 休眠 / 屏保",
    category: "播放",
    runAt: "idle",
    init: init$1
  };
  const urlOf = (input) => {
    if (typeof input === "string") return input;
    if (input && typeof input.url === "string") return input.url;
    try {
      return String(input);
    } catch {
      return "";
    }
  };
  function requestToInit(req) {
    const headers = {};
    try {
      req.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } catch {
    }
    return { method: req.method, headers, credentials: req.credentials, referrer: req.referrer, signal: req.signal };
  }
  function installNetHook(rules) {
    if (window.__BILIKIT_NET_HOOK__) return;
    window.__BILIKIT_NET_HOOK__ = true;
    const origFetch = window.fetch;
    if (origFetch) {
      window.fetch = async function(input, init2) {
        var _a;
        const url = urlOf(input);
        const rule = rules.find((r) => r.match(url));
        if (!rule) return origFetch.apply(this, arguments);
        let realInput = input;
        let realInit = init2;
        const rw = (_a = rule.rewriteRequest) == null ? void 0 : _a.call(rule, url);
        if (rw && (rw.url || rw.credentials)) {
          if (input instanceof Request && !rw.url) {
            realInput = new Request(input, rw.credentials ? { credentials: rw.credentials } : {});
            realInit = init2;
          } else {
            const base = input instanceof Request ? requestToInit(input) : init2 || {};
            realInput = rw.url || url;
            realInit = { ...base, ...rw.credentials ? { credentials: rw.credentials } : {} };
          }
        }
        const resp = await origFetch.call(this, realInput, realInit);
        if (!rule.rewriteResponse) return resp;
        try {
          const text = await resp.clone().text();
          const out = rule.rewriteResponse(JSON.parse(text), url);
          const headers = new Headers(resp.headers);
          headers.delete("content-length");
          headers.delete("content-encoding");
          return new Response(JSON.stringify(out), { status: resp.status, statusText: resp.statusText, headers });
        } catch {
          return resp;
        }
      };
    }
    const OX = window.XMLHttpRequest;
    if (OX) {
      class X extends OX {
        constructor() {
          super(...arguments);
          this.__nlUrl = "";
        }
        open(method, url, ...rest) {
          var _a, _b, _c;
          this.__nlUrl = String(url);
          this.__nlRule = rules.find((r) => r.match(this.__nlUrl));
          this.__nlRw = (_b = (_a = this.__nlRule) == null ? void 0 : _a.rewriteRequest) == null ? void 0 : _b.call(_a, this.__nlUrl);
          return super.open(method, ((_c = this.__nlRw) == null ? void 0 : _c.url) || url, ...rest);
        }
        send(body) {
          var _a;
          const c = (_a = this.__nlRw) == null ? void 0 : _a.credentials;
          if (c === "omit") this.withCredentials = false;
          else if (c) this.withCredentials = true;
          return super.send(body);
        }
        get responseText() {
          var _a;
          const rt = this.responseType;
          if (rt !== "" && rt !== "text") return super.responseText;
          const raw = super.responseText;
          if (this.readyState === 4 && ((_a = this.__nlRule) == null ? void 0 : _a.rewriteResponse) && typeof raw === "string") {
            try {
              return JSON.stringify(this.__nlRule.rewriteResponse(JSON.parse(raw), this.__nlUrl));
            } catch {
              return raw;
            }
          }
          return raw;
        }
        get response() {
          var _a;
          const raw = super.response;
          if (this.readyState === 4 && ((_a = this.__nlRule) == null ? void 0 : _a.rewriteResponse)) {
            if (typeof raw === "string") {
              try {
                return JSON.stringify(this.__nlRule.rewriteResponse(JSON.parse(raw), this.__nlUrl));
              } catch {
                return raw;
              }
            }
            if (raw && typeof raw === "object") {
              try {
                return this.__nlRule.rewriteResponse(raw, this.__nlUrl);
              } catch {
                return raw;
              }
            }
          }
          return raw;
        }
      }
      window.XMLHttpRequest = X;
    }
  }
  const MIXIN_TAB = [
    46,
    47,
    18,
    2,
    53,
    8,
    23,
    32,
    15,
    50,
    10,
    31,
    58,
    3,
    45,
    35,
    27,
    43,
    5,
    49,
    33,
    9,
    42,
    19,
    29,
    28,
    14,
    39,
    12,
    38,
    41,
    13,
    37,
    48,
    7,
    16,
    24,
    55,
    40,
    61,
    26,
    17,
    0,
    1,
    60,
    51,
    30,
    4,
    22,
    25,
    54,
    21,
    56,
    59,
    6,
    63,
    57,
    62,
    11,
    36,
    20,
    34,
    44,
    52
  ];
  const mixinKey = (orig) => MIXIN_TAB.map((n) => orig[n]).join("").slice(0, 32);
  const keyFromUrl = (u) => u ? u.slice(u.lastIndexOf("/") + 1, u.lastIndexOf(".")) : "";
  const LS = "bilikit:wbi-core";
  const today = () => Math.floor(Date.now() / 864e5);
  let cache = null;
  function readKeys() {
    try {
      const img = keyFromUrl(localStorage.getItem("wbi_img_url") || "");
      const sub = keyFromUrl(localStorage.getItem("wbi_sub_url") || "");
      if (img && sub) return { img, sub };
    } catch {
    }
    if (cache && cache.day === today()) return { img: cache.img, sub: cache.sub };
    try {
      const c = JSON.parse(localStorage.getItem(LS) || "null");
      if (c && c.day === today() && c.img && c.sub) {
        cache = c;
        return { img: c.img, sub: c.sub };
      }
    } catch {
    }
    return null;
  }
  function warmKeys(pureFetch) {
    if (readKeys()) return;
    try {
      pureFetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "omit" }).then((r) => r.json()).then((j) => {
        var _a;
        const w = (_a = j == null ? void 0 : j.data) == null ? void 0 : _a.wbi_img;
        const img = keyFromUrl((w == null ? void 0 : w.img_url) || ""), sub = keyFromUrl((w == null ? void 0 : w.sub_url) || "");
        if (img && sub) {
          cache = { img, sub, day: today() };
          try {
            localStorage.setItem(LS, JSON.stringify(cache));
          } catch {
          }
        }
      }).catch(() => {
      });
    } catch {
    }
  }
  function signQuery(params) {
    const keys = readKeys();
    if (!keys) return null;
    const mk = mixinKey(keys.img + keys.sub);
    const wts = Math.floor(Date.now() / 1e3);
    const q = { ...params, wts };
    const query = Object.keys(q).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(q[k]).replace(/[!'()*]/g, ""))}`).join("&");
    return `${query}&w_rid=${md5(query + mk)}`;
  }
  const AUTH_HOSTS = ["message.bilibili.com", "account.bilibili.com", "member.bilibili.com", "pay.bilibili.com", "big.bilibili.com"];
  const AUTH_PATHS = ["/history", "/watchlater", "/favlist", "/medialist", "/account", "/pincenter"];
  function needsRealLogin() {
    if (AUTH_HOSTS.includes(location.hostname)) return true;
    return AUTH_PATHS.some((p) => location.pathname.includes(p));
  }
  function clearFakeUid() {
    try {
      if (/DedeUserID=/.test(document.cookie)) document.cookie = "DedeUserID=; path=/; domain=.bilibili.com; max-age=0";
    } catch {
    }
  }
  function init(_cfg) {
    if (window.__BILIKIT_NO_LOGIN__) return;
    if (window.top !== window.self && !location.hash.includes("bk-drawer")) return;
    if (location.hostname === "passport.bilibili.com") return;
    if (/DedeUserID__ckMd5=/.test(document.cookie)) return;
    if (needsRealLogin()) {
      clearFakeUid();
      return;
    }
    window.__BILIKIT_NO_LOGIN__ = true;
    if (!/DedeUserID=/.test(document.cookie)) {
      try {
        document.cookie = `DedeUserID=${Math.floor(Math.random() * 2 ** 50)}; path=/; domain=.bilibili.com`;
      } catch {
      }
    }
    try {
      const st = document.createElement("style");
      st.textContent = ".van-message.van-message-error{display:none!important}";
      (document.head || document.documentElement).appendChild(st);
    } catch {
    }
    try {
      Object.defineProperty(window, "__playinfo__", { configurable: true, get: () => null, set: () => {
      } });
    } catch {
    }
    const pureFetch = window.fetch.bind(window);
    warmKeys(pureFetch);
    const MID = Math.floor(Math.random() * 1e15);
    const MOCK_USER = {
      isLogin: true,
      is_login: true,
      mid: MID,
      uname: "bilibili",
      face: "https://i0.hdslb.com/bfs/face/member/noface.jpg",
      email_verified: 1,
      mobile_verified: 1,
      money: 0,
      moral: 70,
      level_info: { current_level: 6, current_min: 28800, current_exp: 29050, next_exp: "--" },
      official: { role: 0, title: "", desc: "", type: -1 },
      officialVerify: { type: -1, desc: "" },
      vipStatus: 0,
      vipType: 0
    };
    const rules = [
      // nav：合并成「已登录」，保留 wbi_img 等原字段（→ 登录态 UI + 动态可见）
      {
        match: (u) => u.includes("/x/web-interface/nav"),
        rewriteResponse: (j) => {
          var _a;
          try {
            if ((_a = j == null ? void 0 : j.data) == null ? void 0 : _a.isLogin) return j;
            j.code = 0;
            j.message = "0";
            j.data = Object.assign({}, j.data, MOCK_USER);
          } catch {
          }
          return j;
        }
      },
      // reply：匿名请求（假 cookie 会被拒，去掉反而正常返公开评论）→ 视频/动态下方评论
      {
        match: (u) => u.includes("/x/v2/reply/wbi/main") || u.includes("/x/v2/reply/reply"),
        rewriteRequest: () => ({ credentials: "omit" })
      },
      // player/wbi/v2：改 login_mid / 等级 / 字幕字段 → 播放器 UI 认账（清晰度、字幕可选）
      {
        match: (u) => u.includes("/x/player/wbi/v2"),
        rewriteResponse: (j) => {
          try {
            const d = j == null ? void 0 : j.data;
            if (d) {
              d.login_mid = MID;
              d.need_login_subtitle = false;
              if (d.level_info) d.level_info.current_level = 6;
            }
          } catch {
          }
          return j;
        }
      },
      // playurl：塞 qn=80(1080p) + try_look=1(试看)、去掉旧签名重签 wbi → 1080p 取流
      {
        match: (u) => u.includes("/x/player/wbi/playurl"),
        rewriteRequest: (u) => {
          try {
            const [base, qs = ""] = u.split("?");
            const params = Object.fromEntries(new URLSearchParams(qs));
            delete params.w_rid;
            delete params.wts;
            params.qn = "80";
            params.try_look = "1";
            const signed = signQuery(params);
            if (!signed) return;
            return { url: `${base}?${signed}` };
          } catch {
            return;
          }
        }
      }
    ];
    installNetHook(rules);
  }
  const noLogin = {
    id: "no-login",
    name: "免登录",
    description: "未登录也能看评论 / 他人动态 / 1080p（装它即可替代 beefreely，避免脚本冲突）",
    note: "开启后未登录也能：看视频/动态下方<b>评论</b>、看他人<b>动态</b>、看 <b>1080p</b> 视频。装了它就能卸载 beefreely 等免登录脚本，避免多个脚本抢改请求导致的时好时坏。<br><b>取舍（务必知悉）</b>：① 纯<b>只读</b>——页面「以为」你已登录（显示假账号），但发评论/点赞/投币/收藏/历史同步等需真鉴权的操作都会失败；② <b>看不到评论 IP 属地</b>——评论走匿名请求，B 站服务端只对真登录返回属地字段，免登录下拿不到（与「评论属地」模块不可兼得）；③ 1080p 上限为官方<b>试看</b>，4K/HDR/大会员专享清晰度仍拿不到；④ 仅<b>未登录</b>时生效，检测到已登录会自动让路、不干扰真账号。",
    category: "增强",
    defaultEnabled: false,
    // 侵入性功能，默认关
    runAt: "start",
    init
  };
  const NS = "bk";
  const NEWTAB_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
  const CLOSE_SVG = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  const MARK = "#bk-drawer";
  const MARK_WEB = "#bk-drawer-web";
  const CSS = `
.${NS}-dctrls button{ width:40px; height:40px; border-radius:50%; padding:0; display:flex; align-items:center; justify-content:center; border:1px solid var(--line_regular,#e3e5e7); background:var(--bg1,#fff); color:var(--text2,#61666d); cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,.12); transition:color .16s ease, transform .16s ease, box-shadow .16s ease, opacity .18s ease; }
.${NS}-dctrls button:hover{ color:var(--brand_blue,#00aeec); transform:translateY(-2px); box-shadow:0 5px 16px rgba(0,0,0,.2); }
.${NS}-dctrls button:active{ transform:scale(.94); }
@keyframes bk-dspin{ to{ transform:rotate(360deg); } }
.${NS}-dmask{ position:fixed; inset:0; z-index:100000; background:rgba(0,0,0,.5); opacity:0; pointer-events:none; transition:opacity .3s ease; }
.${NS}-dmask.on{ opacity:1; pointer-events:auto; }
.${NS}-drawer{ position:fixed; left:0; right:0; bottom:0; height:calc(100% - 64px); z-index:100001; display:flex; flex-direction:column; background:var(--bg1,#fff); border-radius:14px 14px 0 0; box-shadow:0 -8px 40px rgba(0,0,0,.35); transform:translateY(100%); transition:transform .32s cubic-bezier(.32,.72,0,1); overflow:hidden; }
.${NS}-drawer.on{ transform:translateY(0); }
.${NS}-dframe{ flex:1; width:100%; border:0; display:block; }
.${NS}-dload{ position:absolute; inset:0; z-index:1; display:flex; align-items:center; justify-content:center; background:#18191c; opacity:0; pointer-events:none; transition:opacity .3s ease; }
.${NS}-drawer.loading .${NS}-dload{ opacity:1; }
.${NS}-dload-cover{ position:absolute; inset:0; background-size:cover; background-position:center; filter:blur(24px) brightness(.6); transform:scale(1.1); }
.${NS}-dspin{ position:relative; width:42px; height:42px; border:3px solid rgba(255,255,255,.2); border-top-color:var(--brand_blue,#00aeec); border-radius:50%; animation:bk-dspin .8s linear infinite; }
@media (prefers-color-scheme: light){ .${NS}-dload{ background:#f4f4f5; } .${NS}-dspin{ border-color:rgba(0,0,0,.12); border-top-color:var(--brand_blue,#00aeec); } }
.${NS}-dctrls{ position:fixed; top:14px; right:18px; z-index:100002; display:flex; gap:10px; opacity:0; pointer-events:none; transition:opacity .3s ease; }
.${NS}-dctrls.on{ opacity:1; pointer-events:auto; }
`;
  let styled = false;
  let mask = null;
  let panel = null;
  let frame = null;
  let ctrls = null;
  let loadCover = null;
  let closeTimer = null;
  let loadTimer = null;
  let curUrl = "";
  let curWebFull = false;
  let curImmersive = false;
  let gotReady = false;
  let gotWebfull = false;
  function tryReveal() {
    if (!gotReady) return;
    if (curWebFull && curImmersive && !gotWebfull) return;
    setLoading(false);
  }
  function frameWin() {
    try {
      return (frame == null ? void 0 : frame.contentWindow) || null;
    } catch {
      return null;
    }
  }
  function setLoading(on) {
    panel == null ? void 0 : panel.classList.toggle("loading", on);
    if (loadTimer) {
      clearTimeout(loadTimer);
      loadTimer = null;
    }
    if (on) loadTimer = setTimeout(() => setLoading(false), 6e3);
  }
  function ensureDom() {
    if (mask) return;
    if (!styled) {
      styled = true;
      const s = document.createElement("style");
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    }
    mask = document.createElement("div");
    mask.className = `${NS}-dmask`;
    panel = document.createElement("div");
    panel.className = `${NS}-drawer`;
    frame = document.createElement("iframe");
    frame.className = `${NS}-dframe`;
    frame.allow = "autoplay; fullscreen; picture-in-picture; encrypted-media; clipboard-write";
    frame.allowFullscreen = true;
    frame.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation allow-modals allow-downloads");
    window.addEventListener("message", (e) => {
      if (e.source !== frameWin()) return;
      if (e.data === "bk-drawer-ready") {
        gotReady = true;
        tryReveal();
      } else if (e.data === "bk-drawer-webfull") {
        gotWebfull = true;
        tryReveal();
      }
    });
    panel.appendChild(frame);
    const load2 = document.createElement("div");
    load2.className = `${NS}-dload`;
    loadCover = document.createElement("div");
    loadCover.className = `${NS}-dload-cover`;
    const spinner = document.createElement("div");
    spinner.className = `${NS}-dspin`;
    load2.append(loadCover, spinner);
    panel.appendChild(load2);
    ctrls = document.createElement("div");
    ctrls.className = `${NS}-dctrls`;
    ctrls.innerHTML = `<button class="bk-newtab" title="在新标签页打开" aria-label="在新标签页打开">${NEWTAB_SVG}</button><button class="bk-close" title="关闭" aria-label="关闭">${CLOSE_SVG}</button>`;
    ctrls.querySelector(".bk-newtab").addEventListener("click", () => {
      if (curUrl) window.open(curUrl, "_blank", "noopener");
      closeDrawer();
    });
    ctrls.querySelector(".bk-close").addEventListener("click", closeDrawer);
    mask.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && (panel == null ? void 0 : panel.classList.contains("on"))) closeDrawer();
    });
    document.body.append(mask, panel, ctrls);
  }
  function openDrawer(url, cover = "", webFull = false, immersive = false) {
    ensureDom();
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = null;
    }
    curUrl = url;
    curWebFull = webFull;
    curImmersive = immersive;
    const marked = url.split("#")[0] + (webFull ? MARK_WEB : MARK);
    if (frame.src !== marked) {
      gotReady = false;
      gotWebfull = false;
      if (loadCover) loadCover.style.backgroundImage = cover ? `url("${cover}")` : "";
      setLoading(true);
      frame.src = marked;
    } else {
      setLoading(false);
    }
    document.documentElement.style.overflow = "hidden";
    requestAnimationFrame(() => {
      mask.classList.add("on");
      panel.classList.add("on");
      ctrls.classList.add("on");
    });
  }
  function closeDrawer() {
    if (!panel || !mask || !ctrls) return;
    mask.classList.remove("on");
    panel.classList.remove("on");
    ctrls.classList.remove("on");
    setLoading(false);
    document.documentElement.style.overflow = "";
    closeTimer = setTimeout(() => {
      if (frame && !(panel == null ? void 0 : panel.classList.contains("on"))) frame.src = "about:blank";
    }, 340);
  }
  const PC_HOSTS = ["https://api.bilibili.com", "https://s1.hdslb.com", "https://i0.hdslb.com", "https://i1.hdslb.com", "https://i2.hdslb.com"];
  const PC_WINDOW = 12e3;
  let lastPc = -Infinity;
  let pcLinks = [];
  function preconnect() {
    const now = performance.now();
    if (now - lastPc < PC_WINDOW) return;
    lastPc = now;
    pcLinks.forEach((l) => l.remove());
    pcLinks = PC_HOSTS.map((href) => {
      const l = document.createElement("link");
      l.rel = "preconnect";
      l.href = href;
      document.head.appendChild(l);
      return l;
    });
  }
  function isVideoUrl(u) {
    try {
      const url = new URL(u, location.href);
      if (!/(^|\.)bilibili\.com$/.test(url.hostname)) return false;
      return /^\/video\/(BV[0-9A-Za-z]+|av\d+)/i.test(url.pathname) || /^\/bangumi\/play\/(ep|ss)\d+/i.test(url.pathname);
    } catch {
      return false;
    }
  }
  function resolve(target) {
    const pick = (root2, url) => {
      const img = root2.querySelector("img");
      return { url, cover: img && (img.currentSrc || img.src) || "" };
    };
    const a = target.closest("a[href]");
    if (a && isVideoUrl(a.href)) return pick(a, a.href.split("#")[0]);
    const card = target.closest("[data-bvid]");
    if (card && card.dataset.bvid && !target.closest(".bk-feed-face, .bk-feed-up")) {
      return pick(card, `https://www.bilibili.com/video/${card.dataset.bvid}`);
    }
    return null;
  }
  function installSiteDrawer() {
    if (window.__BILIKIT_SITE_DRAWER__) return;
    if (window.top !== window.self) return;
    window.__BILIKIT_SITE_DRAWER__ = true;
    document.addEventListener("click", (e) => {
      const mode = get("feed.openMode", "drawer");
      if (mode === "current") return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const hit = resolve(e.target);
      if (!hit) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (mode === "newtab") {
        window.open(hit.url, "_blank", "noopener");
        return;
      }
      const web = mode === "drawer-web";
      openDrawer(hit.url, hit.cover, web, web && get("feed.drawerImmersive", true));
    }, true);
    document.addEventListener("mouseover", (e) => {
      const mode = get("feed.openMode", "drawer");
      if (mode !== "drawer" && mode !== "drawer-web") return;
      if (resolve(e.target)) preconnect();
    }, true);
  }
  syncSharedSettings();
  try {
    localStorage.setItem("bilikit:alive.core", String(Date.now()));
  } catch {
  }
  function hideDrawerChrome() {
    if (window.top === window.self || !location.hash.includes("bk-drawer")) return;
    const ads = [".ad-report", ".video-page-special-card-small", ".video-page-game-card-small", ".slide-ad-exp", ".activity-m-v1", ".pop-live-small-mode", ".right-bottom-banner", ".eva-banner", ".gg-floor-module", ".video-card-ad-small"];
    const s = document.createElement("style");
    s.textContent = `#biliMainHeader,.bili-header,.fixed-header,.international-header{display:none!important}` + ads.join(",") + `{display:none!important}`;
    (document.head || document.documentElement).appendChild(s);
  }
  hideDrawerChrome();
  function setupDrawerReveal() {
    if (window.top === window.self || !location.hash.includes("bk-drawer")) return;
    const wantWeb = location.hash.includes("bk-drawer-web");
    const post = (m) => {
      try {
        window.parent.postMessage(m, "*");
      } catch {
      }
    };
    let readyDone = false;
    let webDone = !wantWeb;
    let bound = false;
    let clicked = false;
    let tries = 0;
    const onReady = () => {
      if (readyDone) return;
      readyDone = true;
      post("bk-drawer-ready");
    };
    const timer = setInterval(() => {
      if (!readyDone) {
        const v = document.querySelector("video");
        if (v) {
          if (v.readyState >= 2) onReady();
          else if (!bound) {
            bound = true;
            v.addEventListener("loadeddata", onReady, { once: true });
            v.addEventListener("canplay", onReady, { once: true });
          }
        }
      }
      if (!webDone) {
        if (document.querySelector('.bpx-player-container[data-screen="web"]')) {
          webDone = true;
          post("bk-drawer-webfull");
        } else if (!clicked) {
          const btn = document.querySelector(".bpx-player-ctrl-web");
          if (btn) {
            btn.click();
            clicked = true;
          }
        }
      }
      if (readyDone && webDone || ++tries > 60) clearInterval(timer);
    }, 150);
  }
  setupDrawerReveal();
  register(
    cdnPick,
    noTrack,
    themeSync,
    commentLocation,
    wakeLock,
    noLogin
    // 注册在 cdn-pick 之后：其 fetch/XHR 与 __playinfo__ hook 需叠在最外层（改请求；cdn-pick 改响应 host）
  );
  runAll();
  installSiteDrawer();
  mountPanel();

})();