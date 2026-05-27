'use strict';

let parse5;
try { parse5 = require('parse5'); } catch (e) {}
let acorn, astring, meriyah;
try { acorn = require('acorn'); } catch (e) {}
try { astring = require('astring'); } catch (e) {}
try { meriyah = require('meriyah'); } catch (e) {}

const EXEMPT_RE = /^(data:|blob:|javascript:|about:|mailto:|tel:|#|\/\/\/)/i;

function resolve(url, base) {
  try { return new URL(url, base).href; } catch { return null; }
}

function exempt(url) {
  if (!url || typeof url !== 'string') return true;
  return EXEMPT_RE.test(url.trim());
}

function shouldProxy(url, backendBase) {
  if (!url || typeof url !== 'string') return false;
  if (exempt(url)) return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (url.includes('/fetch?url=') || url.includes('/sfck/service/')) return false;
  return true;
}

function proxyUrl(abs, backendBase) {
  return `${backendBase}/fetch?url=${encodeURIComponent(abs)}`;
}

function rewriteCss(css, pageUrl, backendBase) {
  css = css.replace(/url\(\s*(['"]*)((?!data:|#|blob:)[^)'"\\s]+)\1\s*\)/gi, (m, q, u) => {
    const abs = resolve(u.trim(), pageUrl);
    if (!abs || !shouldProxy(abs, backendBase)) return m;
    return `url(${q}${proxyUrl(abs, backendBase)}${q})`;
  });
  css = css.replace(/@import\s+(['\"])((?!data:)[^'"]+)\1/gi, (m, q, u) => {
    const abs = resolve(u, pageUrl);
    if (!abs || !shouldProxy(abs, backendBase)) return m;
    return `@import ${q}${proxyUrl(abs, backendBase)}${q}`;
  });
  return css;
}

function rewriteSrcset(val, pageUrl, backendBase) {
  return val.replace(/(https?:\/\/[^\s,]+|(?:\.\/|\.\.\/\/)[^\s,]+)/gi, u => {
    const abs = resolve(u.trim(), pageUrl);
    if (!abs || !shouldProxy(abs, backendBase)) return u;
    return proxyUrl(abs, backendBase);
  });
}

const URL_ATTRS = new Set([
  'src', 'href', 'data-src', 'data-href', 'data-lazy', 'data-original',
  'data-url', 'data-thumb', 'data-image', 'action', 'poster', 'data-bg',
  'background', 'formaction', 'manifest', 'ping', 'data-srcset',
]);

function rewriteHtml(html, pageUrl, backendBase) {
  if (parse5) {
    try {
      const doc = parse5.parse(html);
      walkHtml(doc, pageUrl, backendBase);
      let out = parse5.serialize(doc);
      return injectHead(out, pageUrl, backendBase);
    } catch (e) {}
  }
  return rewriteHtmlRegex(html, pageUrl, backendBase);
}

function walkHtml(node, pageUrl, backendBase) {
  if (node.tagName) {
    const tag = node.tagName.toLowerCase();
    const attrs = node.attrs || [];

    if (tag === 'link') {
      const rel = (getAttr(node.attrs, 'rel') || '').toLowerCase();
      if (rel === 'preload' || rel === 'prefetch' || rel === 'preconnect' || rel === 'dns-prefetch') {
        const href = getAttr(node.attrs, 'href') || '';
        if (/generate_204|\/ping|\/beacon|doubleclick|google-analytics|googlesyndication|googletagmanager/.test(href)) {
          node.attrs = [];
          node.childNodes = [];
          return;
        }
      }
      if (rel === 'icon' || rel === 'shortcut icon' || rel === 'apple-touch-icon' || rel === 'apple-touch-icon-precomposed' || rel === 'mask-icon') return;
    }

    if (tag === 'meta') {
      const equiv = (getAttr(attrs, 'http-equiv') || '').toLowerCase();
      if (equiv === 'content-security-policy' || equiv === 'x-frame-options') {
        node.attrs = [];
        node.childNodes = [];
        return;
      }
      if (equiv === 'refresh') {
        const ca = findAttr(attrs, 'content');
        if (ca) ca.value = ca.value.replace(/(url\s*=\s*)([^\s;,'"]+)/i, (m, p, u) => {
          const abs = resolve(u, pageUrl);
          return abs && shouldProxy(abs, backendBase) ? p + proxyUrl(abs, backendBase) : m;
        });
      }
    }

    node.attrs = attrs.filter(a => {
      const n = a.name.toLowerCase();
      return n !== 'integrity' && n !== 'nonce';
    });

    for (const attr of node.attrs) {
      const name = attr.name.toLowerCase();
      if (URL_ATTRS.has(name)) {
        const abs = resolve(attr.value, pageUrl);
        if (abs && shouldProxy(abs, backendBase)) attr.value = proxyUrl(abs, backendBase);
      } else if (name === 'srcset' || name === 'imagesrcset') {
        attr.value = rewriteSrcset(attr.value, pageUrl, backendBase);
      } else if (name === 'style') {
        attr.value = rewriteCss(attr.value, pageUrl, backendBase);
      }
    }

    if (tag === 'style') {
      for (const child of node.childNodes || []) {
        if (child.nodeName === '#text') child.value = rewriteCss(child.value, pageUrl, backendBase);
      }
    }

    if (tag === 'script') {
      const typeAttr = getAttr(node.attrs, 'type') || '';
      const isModule = typeAttr === 'module';
      const srcVal = getAttr(node.attrs, 'src') || '';
      const hasSrc = !!srcVal;

      if (hasSrc && isModule) {
        for (let i = node.attrs.length - 1; i >= 0; i--) {
          if (node.attrs[i].name.toLowerCase() === 'type') {
            node.attrs.splice(i, 1);
            break;
          }
        }
        for (let i = 0; i < node.attrs.length; i++) {
          if (node.attrs[i].name.toLowerCase() === 'src') {
            try {
              const abs = new URL(node.attrs[i].value, pageUrl).href;
              if (shouldProxy(abs, backendBase)) node.attrs[i].value = proxyUrl(abs, backendBase);
            } catch {}
            break;
          }
        }
      }

      if (!hasSrc) {
        for (const child of node.childNodes || []) {
          if (child.nodeName === '#text' && child.value.trim()) {
            child.value = rewriteJs(child.value, pageUrl, backendBase, isModule);
          }
        }
      }
    }
  }

  for (const child of node.childNodes || []) walkHtml(child, pageUrl, backendBase);
}

function getAttr(attrs, name) {
  const a = (attrs || []).find(a => a.name.toLowerCase() === name);
  return a ? a.value : null;
}

function findAttr(attrs, name) {
  return (attrs || []).find(a => a.name.toLowerCase() === name) || null;
}

function injectHead(html, pageUrl, backendBase) {
  const inject = `<base href="${pageUrl}">\n<script data-sfck="1">\n${buildShim(pageUrl, backendBase)}\n</script>`;
  if (/<head[\s>]/i.test(html)) return html.replace(/(<head[^>]*>)/i, '$1\n' + inject);
  return inject + '\n' + html;
}

function rewriteHtmlRegex(html, pageUrl, backendBase) {
  html = html.replace(/\s+integrity\s*=\s*(['"'])[^'"]*\1/gi, '');
  html = html.replace(/\s+nonce\s*=\s*(['"'])[^'"]*\1/gi, '');
  html = html.replace(/(<script[^>]*?\s)type\s*=\s*(['"])module\2([^>]*?\ssrc\s*=\s*['"])([^'"]+)(['"])/gi, (m, pre, q, srcPre, srcUrl, srcQ) => {
    const abs = resolve(srcUrl, pageUrl);
    if (!abs || !shouldProxy(abs, backendBase)) return m;
    return pre + srcPre + proxyUrl(abs, backendBase) + srcQ;
  });
  html = html.replace(/(<script[^>]*?\ssrc\s*=\s*['"])([^'"]+)(['"][^>]*?\s)type\s*=\s*(['"])module\4/gi, (m, srcPre, srcUrl, mid, q) => {
    const abs = resolve(srcUrl, pageUrl);
    if (!abs || !shouldProxy(abs, backendBase)) return m;
    return srcPre + proxyUrl(abs, backendBase) + mid;
  });
  const UA = 'src|href|data-src|data-href|data-lazy|data-original|data-url|data-thumb|data-image|action|poster|data-bg|background|formaction|manifest|ping';
  html = html.replace(new RegExp(`(\\s(?:${UA})\\s*=\\s*)(['"])((?!data:|javascript:|#|blob:|about:|mailto:|tel:)[^'"]+)\\2`, 'gi'), (m, attr, q, url) => {
    const abs = resolve(url, pageUrl);
    if (!abs || !shouldProxy(abs, backendBase)) return m;
    return `${attr}${q}${proxyUrl(abs, backendBase)}${q}`;
  });
  html = html.replace(/(\s(?:srcset|imagesrcset)\s*=\s*)(['"])((?!data:)[^'"]+)\2/gi, (m, a, q, v) => `${a}${q}${rewriteSrcset(v, pageUrl, backendBase)}${q}`);
  html = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, o, css, c) => o + rewriteCss(css, pageUrl, backendBase) + c);
  html = html.replace(/(<meta[^>]+http-equiv\s*=\s*['"]refresh['"][^>]+content\s*=\s*['"][^'"]*url\s*=\s*)([^'">\s]+)/gi, (m, pre, url) => {
    const abs = resolve(url, pageUrl);
    return abs && shouldProxy(abs, backendBase) ? pre + proxyUrl(abs, backendBase) : m;
  });
  return injectHead(html, pageUrl, backendBase);
}

const JS_AST_SIZE_LIMIT = 800 * 1024;

function rewriteJs(js, pageUrl, backendBase, isModule = false) {
  if (js.length > JS_AST_SIZE_LIMIT) return js;
  if ((meriyah || acorn) && astring) {
    try {
      return rewriteJsAST(js, pageUrl, backendBase, isModule);
    } catch (e) {
      return js;
    }
  }
  return js;
}

function rewriteJsAST(js, pageUrl, backendBase, isModule) {
  const parseOpts = meriyah ? {
    ranges: true,
    module: isModule,
    globalReturn: !isModule,
    next: true,
  } : {
    ecmaVersion: 2023,
    sourceType: isModule ? 'module' : 'script',
    allowReturnOutsideFunction: true,
    ranges: true,
  };

  let ast;
  try {
    ast = meriyah ? meriyah.parseScript(js, parseOpts) : acorn.parse(js, parseOpts);
  } catch (e) {
    if (isModule) {
      const fallbackOpts = meriyah ? {
        ranges: true, module: false, globalReturn: true, next: true,
      } : {
        ecmaVersion: 2023, sourceType: 'script', allowReturnOutsideFunction: true, ranges: true,
      };
      ast = meriyah ? meriyah.parseScript(js, fallbackOpts) : acorn.parse(js, fallbackOpts);
    } else {
      throw e;
    }
  }

  const changes = [];
  walkAst(ast, null, (node, parent) => {
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'eval' && node.arguments.length > 0) {
      const a = node.arguments[0];
      changes.push({ start: node.start, end: node.end, text: `eval(__sfck$rjs(${js.slice(a.start, a.end)}))` });
      return;
    }

    if (node.type === 'ImportExpression') {
      const srcNode = node.source;
      if (srcNode && srcNode.type === 'Literal') {
        const abs = resolve(srcNode.value, pageUrl);
        if (abs && shouldProxy(abs, backendBase)) {
          changes.push({ start: node.start, end: node.end, text: '_sfckImport(' + JSON.stringify(proxyUrl(abs, backendBase)) + ')' });
          return;
        }
      }
      return;
    }

    if (node.type === 'ImportDeclaration' && node.source) {
      const abs = resolve(node.source.value, pageUrl);
      if (abs && shouldProxy(abs, backendBase)) {
        changes.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(proxyUrl(abs, backendBase)) });
      }
      return;
    }

    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) {
      const abs = resolve(node.source.value, pageUrl);
      if (abs && shouldProxy(abs, backendBase)) {
        changes.push({ start: node.source.start, end: node.source.end, text: JSON.stringify(proxyUrl(abs, backendBase)) });
      }
      return;
    }

    if (node.type === 'Literal' && typeof node.value === 'string' && node.value.length >= 8 && /^https?:\/\//i.test(node.value)) {
      const abs = resolve(node.value, pageUrl);
      if (!abs || !shouldProxy(abs, backendBase)) return;
      const allowed = new Set(['CallExpression', 'NewExpression', 'AssignmentExpression', 'Property', 'VariableDeclarator', 'ReturnStatement', 'ArrayExpression', 'ExpressionStatement']);
      if (parent && allowed.has(parent.type)) {
        changes.push({ start: node.start, end: node.end, text: JSON.stringify(proxyUrl(abs, backendBase)) });
      }
    }
  });

  if (!changes.length) return js;
  changes.sort((a, b) => b.start - a.start);
  let out = js;
  for (const c of changes) out = out.slice(0, c.start) + c.text + out.slice(c.end);
  return out;
}

function walkAst(node, parent, fn) {
  if (!node || typeof node !== 'object') return;
  fn(node, parent);
  for (const key of Object.keys(node)) {
    if (key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) if (item && typeof item.type === 'string') walkAst(item, node, fn);
    } else if (child && typeof child.type === 'string') {
      walkAst(child, node, fn);
    }
  }
}

function buildShim(pageUrl, backendBase) {
  let parsedPage = null;
  try { parsedPage = new URL(pageUrl); } catch {}
  const page = parsedPage ? {
    href: parsedPage.href,
    origin: parsedPage.origin,
    host: parsedPage.host,
    hostname: parsedPage.hostname,
    pathname: parsedPage.pathname,
    protocol: parsedPage.protocol,
    port: parsedPage.port,
    search: parsedPage.search,
    hash: parsedPage.hash,
  } : {};

  return `
;(function(){
var _SYM=Symbol.for('sfck.v6');
if(typeof self!=='undefined'&&self[_SYM])return;
if(typeof self!=='undefined')Object.defineProperty(self,_SYM,{value:true,configurable:false,writable:false});

(function(){
  var _prevOnError=self.onerror;
  self.onerror=function(msg,src,line,col,err){
    if(typeof src==='string'&&(src.indexOf('/fetch?url=')>=0||src.indexOf('/sfck/service/')>=0)){
      return true;
    }
    if(_prevOnError)return _prevOnError.call(this,msg,src,line,col,err);
    return false;
  };
  self.addEventListener('unhandledrejection',function(e){
    if(e&&e.reason&&e.reason.stack&&e.reason.stack.indexOf('/fetch?url=')>=0){
      e.preventDefault();
    }
  });
})();

var _PAGE_URL=${JSON.stringify(pageUrl)};
var _PAGE=${JSON.stringify(page)};
var _PFX=${JSON.stringify(backendBase + '/fetch?url=')};
var _SFCK_PFX=${JSON.stringify(backendBase + '/sfck/service/')};
var _BACKEND=${JSON.stringify(backendBase)};
var _BARE=${JSON.stringify(backendBase + '/bare/')};

self.__sfck$rjs=function(s){return s;};

var _N=(function(){
  var n={
    defProp:Object.defineProperty,
    getDesc:Object.getOwnPropertyDescriptor,
    getProto:Object.getPrototypeOf,
    keys:Object.keys,
    assign:Object.assign,
    freeze:Object.freeze,
    create:Object.create,
    slice:Array.prototype.slice,
    push:Array.prototype.push,
    WM:WeakMap,
    WMget:WeakMap.prototype.get,
    WMset:WeakMap.prototype.set,
    WMhas:WeakMap.prototype.has,
    Map:Map,
    Mapget:Map.prototype.get,
    Mapset:Map.prototype.set,
    fetch:self.fetch?self.fetch.bind(self):null,
    XHR:self.XMLHttpRequest||null,
    pushState:history.pushState.bind(history),
    replaceState:history.replaceState.bind(history),
    SA:Element.prototype.setAttribute,
    GA:Element.prototype.getAttribute,
    docWrite:Document.prototype.write,
    docWriteln:Document.prototype.writeln,
  };
  return n;
})();

var _EXEMPT=/^(data:|blob:|javascript:|about:|mailto:|tel:|#)/i;
function _exempt(u){return!u||_EXEMPT.test(String(u).trim());}
function _abs(u){
  if(!u||typeof u!=='string')return u;
  try{return new URL(u,_PAGE_URL).href;}catch{return u;}
}
function _wrap(u){
  if(!u||typeof u!=='string')return u;
  if(_exempt(u))return u;
  var abs;try{abs=new URL(u,_PAGE_URL).href;}catch{return u;}
  if(!abs||!new RegExp('^https?://','i').test(abs))return u;
  if(abs.indexOf(_PFX)===0||abs.indexOf(_SFCK_PFX)===0)return u;
  return _PFX+encodeURIComponent(abs);
}
function _unwrap(v){
  if(!v||typeof v!=='string')return v;
  if(v.indexOf(_PFX)===0)try{return decodeURIComponent(v.slice(_PFX.length));}catch{}
  if(v.indexOf(_SFCK_PFX)===0)try{
    var enc=v.slice(_SFCK_PFX.length);
    var b64=enc.replace(/_/g,'+').replace(/-/g,'/');
    var pad=b64+'==='.slice((b64.length+3)%4);
    var raw=atob(pad);var out='';
    for(var i=0;i<raw.length;i++)out+=String.fromCharCode(raw.charCodeAt(i)^3);
    return out;
  }catch{}
  return v;
}

var _cookieJar={};
var _ckOrigin=_PAGE.origin||'';
try{
  var _docProto=Document.prototype;
  var _ckDesc=_N.getDesc(_docProto,'cookie');
  if(_ckDesc&&!_ckDesc.__sfck){
    _N.defProp(_docProto,'cookie',{
      get:function(){
        var o=_cookieJar[_ckOrigin]||{};
        return Object.keys(o).map(function(k){return k+'='+o[k];}).join('; ');
      },
      set:function(v){
        if(!v||typeof v!=='string')return;
        var parts=v.split(';');
        var eq=parts[0].indexOf('=');
        if(eq<0)return;
        var name=parts[0].slice(0,eq).trim();
        var val=parts[0].slice(eq+1).trim();
        var isDelete=parts.some(function(p){return/^max-age\s*=\s*0/i.test(p.trim());});
        if(!_cookieJar[_ckOrigin])_cookieJar[_ckOrigin]={};
        if(isDelete)delete _cookieJar[_ckOrigin][name];
        else _cookieJar[_ckOrigin][name]=val;
        try{
          navigator.serviceWorker&&navigator.serviceWorker.controller&&
          navigator.serviceWorker.controller.postMessage({$controller$setCookie:{cookies:[{name:name,value:val,isDelete:isDelete}],origin:_ckOrigin}});
        }catch(e){}
      },
      configurable:true,enumerable:true,__sfck:true,
    });
  }
}catch(e){}

try{
  if(navigator.serviceWorker){
    navigator.serviceWorker.addEventListener('message',function(e){
      if(!e.data)return;
      if(e.data.$controller$setCookie){
        var d=e.data.$controller$setCookie;
        var cookies=d.cookies||[];
        if(!_cookieJar[_ckOrigin])_cookieJar[_ckOrigin]={};
        cookies.forEach(function(c){
          if(c.isDelete)delete _cookieJar[_ckOrigin][c.name];
          else _cookieJar[_ckOrigin][c.name]=c.value;
        });
        if(d.id)e.source.postMessage({$sw$setCookieDone:{id:d.id}});
      }
    });
  }
}catch(e){}

try{
  var _dp=Document.prototype;
  var _domD=_N.getDesc(_dp,'domain');
  if(_domD&&!_domD.__sfck)
    _N.defProp(_dp,'domain',{get:function(){return _PAGE.hostname||'';},configurable:true,__sfck:true});
  var _refD=_N.getDesc(_dp,'referrer');
  if(_refD&&!_refD.__sfck)
    _N.defProp(_dp,'referrer',{get:function(){return _PAGE.origin||'';},configurable:true,__sfck:true});
  ['URL','documentURI'].forEach(function(k){
    var d=_N.getDesc(_dp,k);
    if(d&&d.get&&!d.__sfck)
      _N.defProp(_dp,k,{get:function(){return _PAGE_URL;},configurable:true,__sfck:true});
  });
}catch(e){}

try{
  var _loc=location;
  var _lp=Location.prototype;

  function _sfckNav(u){
    try{
      var abs=new URL(u,_PAGE_URL).href;
      if(_exempt(abs)){_lp.assign.call(_loc,abs);return;}
      _N.pushState(null,'',_wrap(abs));
    }catch(e){}
  }

  if(!_lp.assign.__sfck){
    _lp.assign=function(u){if(_exempt(u))return _N.defProp.call(Object,this,'href',{value:u,writable:true});_sfckNav(u);};
    _lp.assign.__sfck=true;
  }
  if(!_lp.replace.__sfck){
    _lp.replace=function(u){_sfckNav(u);};
    _lp.replace.__sfck=true;
  }
  var _hrefD=_N.getDesc(Location.prototype,'href');
  if(_hrefD&&_hrefD.set&&!_hrefD.__sfck){
    _N.defProp(Location.prototype,'href',{
      get:function(){return _PAGE_URL;},
      set:function(v){_sfckNav(v);},
      configurable:true,__sfck:true,
    });
  }

  ['protocol','host','hostname','port','pathname','search','hash','origin'].forEach(function(k){
    var d=_N.getDesc(Location.prototype,k);
    if(d&&d.get&&!d.__sfck){
      _N.defProp(Location.prototype,k,{
        get:function(){return (_PAGE[k]!==undefined)?_PAGE[k]:d.get.call(this);},
        set:k!=='origin'?function(v){try{var u=new URL(_PAGE_URL);u[k]=v;_sfckNav(u.href);}catch(e){}}:undefined,
        configurable:true,__sfck:true,
      });
    }
  });
}catch(e){}

try{
  if(!History.prototype.pushState.__sfck){
    History.prototype.pushState=function(s,t,u){
      if(u&&!_exempt(u))u=_wrap(_abs(u));
      return _N.pushState(s,t,u);
    };
    History.prototype.pushState.__sfck=true;
  }
  if(!History.prototype.replaceState.__sfck){
    History.prototype.replaceState=function(s,t,u){
      if(u&&!_exempt(u))u=_wrap(_abs(u));
      return _N.replaceState(s,t,u);
    };
    History.prototype.replaceState.__sfck=true;
  }
}catch(e){}

try{
  if(_N.WM&&!Window.prototype.open.__sfck){
    var _oWO=Window.prototype.open;
    Window.prototype.open=function(url,target,features){
      if(url&&!_exempt(url)){_N.pushState(null,'',_wrap(_abs(url)));return null;}
      return _oWO.call(this,url,target,features);
    };
    Window.prototype.open.__sfck=true;
  }
}catch(e){}

var _PROXY_ATTRS=new Set(['src','href','data-src','data-lazy','action','poster','formaction','manifest','ping','background','data-bg']);
try{
  var _attrProto=Attr.prototype;
  var _attrValD=_N.getDesc(_attrProto,'value');
  var _attrNameD=_N.getDesc(_attrProto,'name');
  if(_attrValD&&_attrValD.get&&!_attrValD.__sfck){
    _N.defProp(_attrProto,'value',{
      get:function(){
        var v=_attrValD.get.call(this);
        var n=_attrNameD&&_attrNameD.get?_attrNameD.get.call(this):'';
        return _PROXY_ATTRS.has(n.toLowerCase())?_unwrap(v):v;
      },
      set:function(v){
        if(_attrValD.set){
          var n=_attrNameD&&_attrNameD.get?_attrNameD.get.call(this):'';
          _attrValD.set.call(this,_PROXY_ATTRS.has(n.toLowerCase())?_wrap(v):v);
        }
      },
      configurable:true,__sfck:true,
    });
  }
}catch(e){}

try{
  if(_N.SA&&!_N.SA.__sfck){
    Element.prototype.setAttribute=function(name,value){
      if(typeof value==='string'&&_PROXY_ATTRS.has((name||'').toLowerCase())){
        try{var w=_wrap(value);if(w!==value)return _N.SA.call(this,name,w);}catch(e){}
      }
      var nl=(name||'').toLowerCase();
      if(nl==='type'&&typeof value==='string'&&value.toLowerCase()==='module'){
        try{
          if(this.nodeName&&this.nodeName.toUpperCase()==='SCRIPT'&&this.src)return;
        }catch(e){}
      }
      return _N.SA.call(this,name,value);
    };
    Element.prototype.setAttribute.__sfck=true;
    Element.prototype.getAttribute=function(name){
      var v=_N.GA.call(this,name);
      if(v&&_PROXY_ATTRS.has((name||'').toLowerCase()))return _unwrap(v);
      return v;
    };
    Element.prototype.getAttribute.__sfck=true;
  }
}catch(e){}

['HTMLImageElement','HTMLVideoElement','HTMLAudioElement','HTMLSourceElement',
 'HTMLIFrameElement','HTMLEmbedElement','HTMLScriptElement',
 'HTMLLinkElement','HTMLTrackElement'].forEach(function(cn){
  try{
    var el=self[cn];if(!el)return;
    var d=_N.getDesc(el.prototype,'src');
    if(d&&d.set&&!d.__sfck){
      (function(desc){
        _N.defProp(el.prototype,'src',{
          get:function(){return _unwrap(desc.get.call(this));},
          set:function(v){desc.set.call(this,_wrap(v));},
          configurable:true,__sfck:true,
        });
      })(d);
    }
  }catch(e){}
});

try{
  function _sfckScrub(node){
    if(!node||node.nodeType!==1)return;
    var tag=node.nodeName&&node.nodeName.toUpperCase();
    if(tag==='SCRIPT'){
      var t=node.getAttribute&&node.getAttribute('type');
      var s=node.getAttribute&&node.getAttribute('src');
      if(t&&t.toLowerCase()==='module'&&s){
        node.removeAttribute('type');
      }
    }
    try{
      var kids=node.querySelectorAll('script[type=module][src]');
      for(var i=0;i<kids.length;i++)kids[i].removeAttribute('type');
    }catch(e){}
  }
  var _origAC=Node.prototype.appendChild;
  if(_origAC&&!_origAC.__sfck){
    Node.prototype.appendChild=function(node){
      try{_sfckScrub(node);}catch(e){}
      return _origAC.call(this,node);
    };
    Node.prototype.appendChild.__sfck=true;
  }
  var _origIB=Node.prototype.insertBefore;
  if(_origIB&&!_origIB.__sfck){
    Node.prototype.insertBefore=function(node,ref){
      try{_sfckScrub(node);}catch(e){}
      return _origIB.call(this,node,ref);
    };
    Node.prototype.insertBefore.__sfck=true;
  }
}catch(e){}

['HTMLAnchorElement','HTMLAreaElement'].forEach(function(cn){
  try{
    var el=self[cn];if(!el)return;
    var d=_N.getDesc(el.prototype,'href');
    if(d&&d.set&&!d.__sfck){
      (function(desc){
        _N.defProp(el.prototype,'href',{
          get:function(){return _unwrap(desc.get.call(this));},
          set:function(v){desc.set.call(this,_wrap(v));},
          configurable:true,__sfck:true,
        });
      })(d);
    }
  }catch(e){}
});

try{
  if(_N.fetch&&!_N.fetch.__sfck){
    self.fetch=function(input,init){
      if(typeof input==='string'&&!_exempt(input))input=_wrap(_abs(input));
      else if(input&&typeof input==='object'&&input.url){
        try{input=new Request(_wrap(_abs(input.url)),input);}catch(e){}
      }
      return _N.fetch(input,init);
    };
    self.fetch.__sfck=true;
  }
}catch(e){}

try{
  if(_N.XHR){
    var _xhrOpen=_N.XHR.prototype.open;
    if(!_xhrOpen.__sfck){
      _N.XHR.prototype.open=function(method,url,async,user,pass){
        var u=typeof url==='string'&&!_exempt(url)?_wrap(_abs(url)):url;
        return arguments.length>4?_xhrOpen.call(this,method,u,async,user,pass):
               arguments.length>3?_xhrOpen.call(this,method,u,async,user):
               arguments.length>2?_xhrOpen.call(this,method,u,async):
               _xhrOpen.call(this,method,u);
      };
      _N.XHR.prototype.open.__sfck=true;
    }
  }
}catch(e){}

var _sfckLoadedScripts=new Set();
function _sfckImport(url){
  if(_sfckLoadedScripts.has(url))return Promise.resolve({});
  _sfckLoadedScripts.add(url);
  return new Promise(function(resolve,reject){
    try{
      var s=document.createElement('script');
      s.type='';
      s.src=url;
      s.onload=function(){resolve({});};
      s.onerror=function(e){
        console.warn('[sfck] _sfckImport failed:',url);
        resolve({});
      };
      (document.head||document.documentElement).appendChild(s);
    }catch(e){resolve({});}
  });
}

try{
  if(self.WebSocket&&!self.WebSocket.__sfck){
    var _WS=self.WebSocket;
    var _WS_DIRECT=/(\\.firebaseio\\.com|\\.firebase\\.com|\\.stripe\\.com|\\.pusher\\.com|\\.sockjs\\.org)$/i;
    function _sfckWS(url,proto){
      try{
        var u=String(typeof url==='object'&&url.href?url.href:url);
        var wsHost=u.replace(new RegExp('^wss?://','i'),'').split(/[/?#]/)[0];
        if(new RegExp('^wss?://').test(u)&&!_WS_DIRECT.test(wsHost)){
          var wsp=location.protocol==='https:'?'wss:':'ws:';
          var bHost=new URL(_BARE).host;
          var bareUrl=wsp+'//'+bHost+'/bare/?url='+encodeURIComponent(u);
          return proto?new _WS(bareUrl,proto):new _WS(bareUrl);
        }
      }catch(e){}
      return proto?new _WS(url,proto):new _WS(url);
    }
    _sfckWS.prototype=_WS.prototype;
    _sfckWS.CONNECTING=0;_sfckWS.OPEN=1;_sfckWS.CLOSING=2;_sfckWS.CLOSED=3;
    _sfckWS.__sfck=true;
    self.WebSocket=_sfckWS;
  }
}catch(e){}

try{
  if(self.EventSource&&!self.EventSource.__sfck){
    var _ES=self.EventSource;
    function _sfckES(url,init){var w=_wrap(String(url));return init?new _ES(w,init):new _ES(w);}
    _sfckES.prototype=_ES.prototype;_sfckES.__sfck=true;
    self.EventSource=_sfckES;
  }
}catch(e){}

try{
  if(navigator.sendBeacon&&!navigator.sendBeacon.__sfck){
    var _oSB=navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon=function(url,data){return _oSB(_wrap(url),data);};
    navigator.sendBeacon.__sfck=true;
  }
}catch(e){}

try{
  if(self.Worker&&!self.Worker.__sfck){
    var _oW=self.Worker;
    function _sfckWorker(url,opts){return new _oW(_wrap(String(url)),opts);}
    _sfckWorker.prototype=_oW.prototype;_sfckWorker.__sfck=true;
    self.Worker=_sfckWorker;
  }
}catch(e){}
try{
  if(typeof importScripts!=='undefined'&&!importScripts.__sfck){
    var _oIS=importScripts;
    self.importScripts=function(){
      var args=Array.prototype.slice.call(arguments).map(function(u){return _wrap(String(u));});
      return _oIS.apply(self,args);
    };
    self.importScripts.__sfck=true;
  }
}catch(e){}

try{
  if(self.Audio&&!self.Audio.__sfck){
    var _oAu=self.Audio;
    function _sfckAudio(url){return url?new _oAu(_wrap(String(url))):new _oAu();}
    _sfckAudio.prototype=_oAu.prototype;_sfckAudio.__sfck=true;
    self.Audio=_sfckAudio;
  }
}catch(e){}

var _sPfx='__sfck_'+(_PAGE.origin||'x')+'_';
function _mkStorage(real){
  if(!real)return null;
  return new Proxy({},{
    get:function(t,k){
      if(k==='length')return real.length;
      if(k==='key')return function(i){var rk=real.key(i);return rk&&rk.startsWith(_sPfx)?rk.slice(_sPfx.length):null;};
      if(k==='getItem')return function(n){return real.getItem(_sPfx+n);};
      if(k==='setItem')return function(n,v){return real.setItem(_sPfx+n,v);};
      if(k==='removeItem')return function(n){return real.removeItem(_sPfx+n);};
      if(k==='clear')return function(){
        var rm=[];for(var i=0;i<real.length;i++){var rk=real.key(i);if(rk&&rk.startsWith(_sPfx))rm.push(rk);}
        rm.forEach(function(k){real.removeItem(k);});
      };
      return real.getItem(_sPfx+k);
    },
    set:function(t,k,v){real.setItem(_sPfx+k,v);return true;},
    deleteProperty:function(t,k){real.removeItem(_sPfx+k);return true;},
  });
}
try{
  var _lsProx=_mkStorage(localStorage);
  var _ssProx=_mkStorage(sessionStorage);
  if(_lsProx&&!Object.getOwnPropertyDescriptor(Window.prototype,'localStorage').__sfck){
    _N.defProp(Window.prototype,'localStorage',{get:function(){return _lsProx;},configurable:true,__sfck:true});
    _N.defProp(Window.prototype,'sessionStorage',{get:function(){return _ssProx;},configurable:true,__sfck:true});
  }
}catch(e){}

function _rewriteHtmlStr(s){
  if(!s||typeof s!=='string')return s;
  return s
    .replace(/(\ssrc\s*=\s*)(['"])((?!data:|blob:|javascript:)[^'"]+)\2/gi,function(m,a,q,u){
      var abs=_abs(u);return(abs&&!new RegExp('^https?://').test(abs)===false&&u!==_wrap(abs))?a+q+_wrap(abs)+q:m;
    })
    .replace(/(\shref\s*=\s*)(['"])((?!data:|javascript:|#|blob:|about:|mailto:|tel:)[^'"]+)\2/gi,function(m,a,q,u){
      var abs=_abs(u);return(abs&&!_exempt(abs))?a+q+_wrap(abs)+q:m;
    });
}
try{
  if(_N.docWrite&&!_N.docWrite.__sfck){
    Document.prototype.write=function(){
      var args=Array.prototype.slice.call(arguments).map(_rewriteHtmlStr);
      return _N.docWrite.apply(this,args);
    };
    Document.prototype.write.__sfck=true;
    Document.prototype.writeln=function(){
      var args=Array.prototype.slice.call(arguments).map(_rewriteHtmlStr);
      return _N.docWriteln.apply(this,args);
    };
    Document.prototype.writeln.__sfck=true;
  }
}catch(e){}

try{
  var _iHD=_N.getDesc(Element.prototype,'innerHTML');
  if(_iHD&&_iHD.set&&!_iHD.__sfck){
    _N.defProp(Element.prototype,'innerHTML',{
      get:function(){return _iHD.get.call(this);},
      set:function(v){return _iHD.set.call(this,_rewriteHtmlStr(v));},
      configurable:true,__sfck:true,
    });
  }
  var _oHD=_N.getDesc(Element.prototype,'outerHTML');
  if(_oHD&&_oHD.set&&!_oHD.__sfck){
    _N.defProp(Element.prototype,'outerHTML',{
      get:function(){return _oHD.get.call(this);},
      set:function(v){return _oHD.set.call(this,_rewriteHtmlStr(v));},
      configurable:true,__sfck:true,
    });
  }
  var _iAH=Element.prototype.insertAdjacentHTML;
  if(_iAH&&!_iAH.__sfck){
    Element.prototype.insertAdjacentHTML=function(pos,html){return _iAH.call(this,pos,_rewriteHtmlStr(html));};
    Element.prototype.insertAdjacentHTML.__sfck=true;
  }
}catch(e){}

try{
  if(self.DOMParser){
    var _pFS=DOMParser.prototype.parseFromString;
    if(!_pFS.__sfck){
      DOMParser.prototype.parseFromString=function(s,type){
        return _pFS.call(this,type&&type.includes('html')?_rewriteHtmlStr(s):s,type);
      };
      DOMParser.prototype.parseFromString.__sfck=true;
    }
  }
}catch(e){}

try{
  new MutationObserver(function(muts){
    muts.forEach(function(mut){
      if(mut.type==='attributes'){
        var n=mut.target,a=mut.attributeName;
        if(_PROXY_ATTRS.has(a)){
          var v=_N.GA.call(n,a);
          if(v&&!_exempt(v)&&v.indexOf(_PFX)<0&&v.indexOf(_SFCK_PFX)<0){
            var w=_wrap(_abs(v));if(w!==v)_N.SA.call(n,a,w);
          }
        }
        return;
      }
      mut.addedNodes.forEach(function(node){
        if(!node||node.nodeType!==1)return;
        var all=[node];
        try{if(node.querySelectorAll)all=all.concat(Array.from(node.querySelectorAll('[src],[href],[poster],[srcset],[data-src]')));}catch(e){}
        all.forEach(function(el){
          _PROXY_ATTRS.forEach(function(attr){
            var v=_N.GA.call(el,attr);
            if(v&&!_exempt(v)&&new RegExp('^https?://').test(v)&&v.indexOf(_PFX)<0){
              try{_N.SA.call(el,attr,_wrap(v));}catch(e){}
            }
          });
          var ss=_N.GA.call(el,'srcset');
          if(ss){
            try{
              var rs=ss.replace(new RegExp('(https?://[^\\s,]+)','gi'),function(u){return _wrap(u);});
              if(rs!==ss)_N.SA.call(el,'srcset',rs);
            }catch(e){}
          }
        });
      });
    });
  }).observe(document.documentElement,{
    childList:true,subtree:true,attributes:true,
    attributeFilter:['src','href','poster','srcset','data-src','data-lazy'],
  });
}catch(e){}

document.addEventListener('click',function(e){
  var a=e.target&&e.target.closest?e.target.closest('a'):null;
  if(!a)return;
  var href=_N.GA.call(a,'href');
  if(!href||_exempt(href))return;
  var abs=_abs(href);
  if(_exempt(abs))return;
  e.preventDefault();e.stopPropagation();
  _N.pushState(null,'',_wrap(abs));
},true);

document.addEventListener('submit',function(e){
  e.preventDefault();e.stopPropagation();
  var f=e.target;
  var action=_abs(_N.GA.call(f,'action')||_PAGE_URL);
  var params=new URLSearchParams(new FormData(f)).toString();
  _N.pushState(null,'',_wrap(action+(params?'?'+params:'')));
},true);

try{
  HTMLFormElement.prototype.submit=function(){
    var action=_abs(_N.GA.call(this,'action')||_PAGE_URL);
    var params=new URLSearchParams(new FormData(this)).toString();
    _N.pushState(null,'',_wrap(action+(params?'?'+params:'')));
  };
}catch(e){}

(function(){
  if(_PAGE.hostname.indexOf('youtube.com')<0&&_PAGE.hostname.indexOf('youtu.be')<0&&
     _PAGE.hostname.indexOf('googlevideo.com')<0)return;

  function _patchYtcfg(cfg){
    if(!cfg||typeof cfg!=='object')return cfg;
    if(cfg.INNERTUBE_API_URL){
      try{cfg.INNERTUBE_API_URL=_wrap(_abs(cfg.INNERTUBE_API_URL));}catch(e){}
    }
    ['THUMB_CDN_URL','GCK_API_URL','VISITOR_DATA_URL'].forEach(function(k){
      if(cfg[k]){try{cfg[k]=_wrap(_abs(cfg[k]));}catch(e){}}
    });
    return cfg;
  }

  try{
    var _ytcfgInterval=setInterval(function(){
      if(typeof self.ytcfg!=='undefined'&&self.ytcfg.set&&!self.ytcfg.set.__sfck){
        var _origSet=self.ytcfg.set.bind(self.ytcfg);
        self.ytcfg.set=function(k,v){
          if(typeof k==='object'){_patchYtcfg(k);}
          else if(typeof k==='string'&&typeof v==='string'&&
                  (k==='INNERTUBE_API_URL'||k==='THUMB_CDN_URL'||k==='GCK_API_URL')){
            try{v=_wrap(_abs(v));}catch(e){}
          }
          return _origSet(k,v);
        };
        self.ytcfg.set.__sfck=true;
        clearInterval(_ytcfgInterval);
      }
    },50);
    setTimeout(function(){clearInterval(_ytcfgInterval);},5000);
  }catch(e){}

  try{
    if(typeof self.yt!=='undefined'&&self.yt.config_){
      _patchYtcfg(self.yt.config_);
    }
  }catch(e){}

  try{
    var _origCE=document.createElement.bind(document);
    if(!_origCE.__sfck){
      document.createElement=function(tag){
        var el=_origCE(tag);
        return el;
      };
      document.createElement.__sfck=true;
    }
  }catch(e){}

  var _YT_CDN=/\.(ytimg|googlevideo|ggpht|googleusercontent|gstatic)\.com/i;
  try{
    if(_N.fetch&&!self.__sfck_yt_fetch){
      self.__sfck_yt_fetch=true;
      var _baseFetch=self.fetch;
      self.fetch=function(input,init){
        try{
          var u=typeof input==='string'?input:(input&&input.url?input.url:'');
          if(u&&_YT_CDN.test(u)&&u.indexOf(_PFX)<0&&u.indexOf(_SFCK_PFX)<0){
            var wrapped=_wrap(_abs(u));
            if(typeof input==='string')input=wrapped;
            else if(input&&typeof input==='object')try{input=new Request(wrapped,input);}catch(e){}
          }
        }catch(e){}
        return _baseFetch.call(self,input,init);
      };
      self.fetch.__sfck=true;
    }
  }catch(e){}
})();

try{window.parent.postMessage({type:'EP_READY',url:_PAGE_URL},'*');}catch(e){}

})();
`;
}

module.exports = { rewriteHtml, rewriteCss, rewriteJs, rewriteSrcset, buildShim };
