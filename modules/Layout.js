/*

Usage:

```
var Layout = require("Layout");
var layout = new Layout( layoutObject, btns, options )
layout.render(optionalObject);
```

For example:

```
var Layout = require("Layout");
var layout = new Layout( {
  type:"v", c: [
    {type:"txt", font:"20%", label:"12:00" },
    {type:"txt", font:"6x8", label:"The Date" }
  ]
});
g.clear();
layout.render();
```


layoutObject has:

* A `type` field of:
  * `undefined` - blank, can be used for padding
  * `"txt"` - a text label, with value `label` and `r` for text rotation. 'font' is required
  * `"btn"` - a button, with value `label` and callback `cb`
  * `"img"` - an image where the function `src` is called to return an image to draw
  * `"custom"` - a custom block where `render(layoutObj)` is called to render
  * `"h"` - Horizontal layout, `c` is an array of more `layoutObject`
  * `"v"` - Veritical layout, `c` is an array of more `layoutObject`
* A `id` field. If specified the object is added with this name to the
  returned `layout` object, so can be referenced as `layout.foo`
* A `font` field, eg `6x8` or `30%` to use a percentage of screen height
* A `col` field, eg `#f00` for red
* A `bgCol` field for background color (will automatically fill on render)
* A `halign` field to set horizontal alignment. `-1`=left, `1`=right, `0`=center
* A `valign` field to set vertical alignment. `-1`=top, `1`=bottom, `0`=center
* A `pad` integer field to set pixels padding
* A `fillx` int to choose if the object should fill available space in x. 0=no, 1=yes, 2=2x more space
* A `filly` int to choose if the object should fill available space in y. 0=no, 1=yes, 2=2x more space
* `width` and `height` fields to optionally specify minimum size

btns is an array of objects containing:

* `label` - the text on the button
* `cb` - a callback function
* `cbl` - a callback function for long presses

options is an object containing:

* `lazy` - a boolean specifying whether to enable automatic lazy rendering

If automatic lazy rendering is enabled, calls to `layout.render()` will attempt to automatically
determine what objects have changed or moved, clear their previous locations, and re-render just those objects.

Once `layout.update()` is called, the following fields are added
to each object:

* `x` and `y` for the top left position
* `w` and `h` for the width and height
* `_w` and `_h` for the **minimum** width and height


Other functions:

* `layout.update()` - update positions of everything if contents have changed
* `layout.debug(obj)` - draw outlines for objects on screen
* `layout.clear(obj)` - clear the given object (you can also just specify `bgCol` to clear before each render)

*/


function Layout(layout, buttons, options) {
  this._l = this.l = layout;
  this.b = buttons;
  // Do we have >1 physical buttons?
  this.physBtns = (process.env.HWVERSION==2) ? 1 : 3;
  this.yOffset = Object.keys(global.WIDGETS).length ? 24 : 0;

  options = options || {};
  this.lazy = options.lazy || false;

  if (buttons) {
    if (this.physBtns >= buttons.length) {
      // enough physical buttons
      let btnHeight = Math.floor((g.getHeight()-this.yOffset) / this.physBtns);
      if (Bangle.btnWatch) Bangle.btnWatch.forEach(clearWatch);
      Bangle.btnWatch = [];
      if (this.physBtns > 2 && buttons.length==1)
        buttons.unshift({label:""}); // pad so if we have a button in the middle
      while (this.physBtns > buttons.length)
        buttons.push({label:""});
      if (buttons[0]) Bangle.btnWatch.push(setWatch(pressHandler.bind(this,0), BTN1, {repeat:true,edge:-1}));
      if (buttons[1]) Bangle.btnWatch.push(setWatch(pressHandler.bind(this,1), BTN2, {repeat:true,edge:-1}));
      if (buttons[2]) Bangle.btnWatch.push(setWatch(pressHandler.bind(this,2), BTN3, {repeat:true,edge:-1}));
      this._l.width = g.getWidth()-8; // text width
      this._l = {type:"h", filly:1, c: [
        this._l,
        {type:"v", pad:1, filly:1, c: buttons.map(b=>(b.type="txt",b.font="6x8",b.height=btnHeight,b.r=1,b))}
      ]};
    } else {
      let btnHeight = Math.floor((g.getHeight()-this.yOffset) / buttons.length);
      this._l.width = g.getWidth()-20; // button width
      this._l = {type:"h", c: [
        this._l,
        {type:"v", c: buttons.map(b=>(b.type="btn",b.h=btnHeight,b.w=32,b.r=1,b))}
      ]};
    }
  }
  if (process.env.HWVERSION==2) {
    Bangle.touchHandler = function(_,e){touchHandler(layout,e)};
    Bangle.on('touch',Bangle.touchHandler);    
  }
  
  // add IDs
  var ll = this;
  function idRecurser(l) {
    if (l.id) ll[l.id] = l;
    if (!l.type) l.type="";
    if (l.c) l.c.forEach(idRecurser);
  }
  idRecurser(layout);
  this.update();
}

Layout.prototype.remove = function (l) {
  if (Bangle.btnWatch) {
    Bangle.btnWatch.forEach(clearWatch);
    delete Bangle.btnWatch;
  }
  if (Bangle.touchHandler) {
    Bangle.removeListener("touch",Bangle.touchHandler);
    delete Bangle.touchHandler;
  }
};

// Handler for button watch events
function pressHandler(btn,e) {
  if (e.time-e.lastTime > 0.75 && this.b[btn].cbl)
    this.b[btn].cbl(e);
  else
    if (this.b[btn].cb) this.b[btn].cb(e);
}

// Handler for touch events
function touchHandler(l,e) {
  if (l.type=="btn" && l.cb && e.x>=l.x && e.y>=l.y && e.x<=l.x+l.w && e.y<=l.y+l.h)
    l.cb(e);
  if (l.c) l.c.forEach(n => touchHandler(n,e));
}

function prepareLazyRender(l, rectsToClear, drawList, rects, bgCol) {
  if ((l.bgCol != null && l.bgCol != bgCol) || l.type == "txt" || l.type == "btn" || l.type == "img" || l.type == "custom") {
    // Hash the layoutObject without including its children
    let c = l.c;
    delete l.c;
    let hash = "H"+E.CRC32(E.toJS(l)); // String keys maintain insertion order
    if (c) l.c = c;

    if (!delete rectsToClear[hash]) {
      rects[hash] = {bg: bgCol, r: [l.x,l.y,l.x+l.w-1,l.y+l.h-1]};
      if (drawList) {
        drawList.push(l);
        drawList = null; // Prevent children from being redundantly added to the drawList
      }
    }
  }

  if (l.c) for (let ch of l.c) prepareLazyRender(ch, rectsToClear, drawList, rects, l.bgCol == null ? bgCol : l.bgCol);
}

Layout.prototype.render = function (l) {
  if (!l) l = this._l;
  
  function render(l) {"ram"
    g.reset();
    if (l.col) g.setColor(l.col);
    if (l.bgCol!==undefined) g.setBgColor(l.bgCol).clearRect(l.x,l.y,l.x+l.w-1,l.y+l.h-1);
    cb[l.type](l);
  }
  
  var cb = {
    "":function(){},
    "txt":function(l){
       g.setFont(l.font,l.fsz).setFontAlign(0,0,l.r).drawString(l.label, l.x+(l.w>>1), l.y+(l.h>>1), true/*solid bg*/);
    }, "btn":function(l){
      var poly = [
        l.x,l.y+4,
        l.x+4,l.y,
        l.x+l.w-5,l.y,
        l.x+l.w-1,l.y+4,
        l.x+l.w-1,l.y+l.h-5,
        l.x+l.w-5,l.y+l.h-1,
        l.x+4,l.y+l.h-1,
        l.x,l.y+l.h-5,
        l.x,l.y+4
      ];
    g.setColor(g.theme.bgH).fillPoly(poly).setColor(l.selected ? g.theme.fgH : g.theme.fg).drawPoly(poly).setFont("4x6",2).setFontAlign(0,0,l.r).drawString(l.label,l.x+l.w/2,l.y+l.h/2);
  }, "img":function(l){
    g.drawImage(l.src(), l.x, l.y);
  }, "custom":function(l){
    l.render(l);
  },"h":function(l) { l.c.forEach(render); },
    "v":function(l) { l.c.forEach(render); }
  };

  if (this.lazy) {
    // we have to use 'var' here not 'let', otherwise the minifier
    // renames vars to the same name, which causes problems as Espruino
    // doesn't yet honour the scoping of 'let'
    if (!this.rects) this.rects = {};
    var rectsToClear = this.rects.clone();
    var drawList = [];
    prepareLazyRender(l, rectsToClear, drawList, this.rects, g.getBgColor());
    for (var h in rectsToClear) delete this.rects[h];
    var clearList = Object.keys(rectsToClear).map(k=>rectsToClear[k]).reverse(); // Rects are cleared in reverse order so that the original bg color is restored
    for (var r of clearList) g.setBgColor(r.bg).clearRect.apply(g, r.r);
    drawList.forEach(render);
  } else { // non-lazy
    render(l);
  }
};

Layout.prototype.layout = function (l) {
  // l = current layout element
  // exw,exh = extra width/height available
  switch (l.type) {
    case "h": {
      let x = l.x + (l.w-l._w)/2;
      var fillx = l.c && l.c.reduce((a,l)=>a+(0|l.fillx),0);
      if (fillx) { x = l.x; }
      l.c.forEach(c => {
        c.w = c._w + ((0|c.fillx)*(l.w-l._w)/(fillx||1));
        c.h = c.filly ? l.h : c._h;
        c.x = x;
        c.y = l.y + (1+(0|c.valign))*(l.h-c.h)/2;
        x += c.w;
        if (c.pad) {
          x += c.pad*2;
          c.w += c.pad*2;
          c.h += c.pad*2;
        }
        if (c.c) this.layout(c);
      });
      break;
    }
    case "v": {
      let y = l.y + (l.h-l._h)/2;
      var filly = l.c && l.c.reduce((a,l)=>a+(0|l.filly),0);
      if (filly) { y = l.y; }
      l.c.forEach(c => {
        c.w = c.fillx ? l.w : c._w;
        c.h = c._h + ((0|c.filly)*(l.h-l._h)/(filly||1));
        c.x = l.x + (1+(0|c.halign))*(l.w-c.w)/2;
        c.y = y;
        y += c.h;
        if (c.pad) {
          y += c.pad*2;
          c.w += c.pad*2;
          c.h += c.pad*2;
        }
        if (c.c) this.layout(c);
      });
      break;
    }
  }
};
Layout.prototype.debug = function(l,c) {
  if (!l) l = this._l;
  c=c||1;
  g.setColor(c&1,c&2,c&4).drawRect(l.x+c-1, l.y+c-1, l.x+l.w-c, l.y+l.h-c);
  c++;
  if (l.c) l.c.forEach(n => this.debug(n,c));
};
Layout.prototype.update = function() {
  var l = this._l;
  var w = g.getWidth();
  var y = this.yOffset;
  var h = g.getHeight()-y;
  // update sizes
  function updateMin(l) {"ram"
    cb[l.type](l);
    if (l.r&1) { // rotation
      var t = l._w;l._w=l._h;l._h=t;
    }
    l._w = Math.max(l._w, 0|l.width);
    l._h = Math.max(l._h, 0|l.height);
  }
  var cb = {
    "txt" : function(l) {
      if (l.font.endsWith("%"))
        l.font = "Vector"+Math.round(g.getHeight()*l.font.slice(0,-1)/100);
      // FIXME ':'/fsz not needed in new firmwares - it's handled internally
      if (l.font.includes(":")) {
        var f = l.font.split(":");
        l.font = f[0];
        l.fsz = f[1];
      }
      g.setFont(l.font,l.fsz);
      l._h = g.getFontHeight();
      l._w = g.stringWidth(l.label);
    }, "btn": function(l) {
      l._h = 24;
      l._w = 14 + l.label.length*8;
    }, "img": function(l) {
      var im = E.toString(l.src());
      l._h = im.charCodeAt(0);
      l._w = im.charCodeAt(1);
    }, "": function(l) {
      // size should already be set up in width/height
      l._w = 0;
      l._h = 0;
    }, "custom": function(l) {
      // size should already be set up in width/height
      l._w = 0;
      l._h = 0;
    }, "h": function(l) {
      l.c.forEach(updateMin);
      l._h = l.c.reduce((a,b)=>Math.max(a,b._h+(b.pad<<1)),0);
      l._w = l.c.reduce((a,b)=>a+b._w+(b.pad<<1),0);
      if (l.c.some(c=>c.fillx)) l.fillx = 1;
      if (l.c.some(c=>c.filly)) l.filly = 1;
    }, "v": function(l) {
      l.c.forEach(updateMin);
      l._h = l.c.reduce((a,b)=>a+b._h+(b.pad<<1),0);
      l._w = l.c.reduce((a,b)=>Math.max(a,b._w+(b.pad<<1)),0);
      if (l.c.some(c=>c.fillx)) l.fillx = 1;
      if (l.c.some(c=>c.filly)) l.filly = 1;
    }
  };
  updateMin(l);
  // center
  if (l.fillx || l.filly) {
    l.w = w;
    l.h = h;
    l.x = 0;
    l.y = y;
  } else {
    l.w = l._w;
    l.h = l._h;
    l.x = (w-l.w)/2;
    l.y = y+(h-l.h)/2;
  }
  // layout children
  this.layout(l);
};

Layout.prototype.clear = function(l) {
  if (!l) l = this._l;
  g.reset();
  if (l.bgCol!==undefined) g.setBgColor(l.bgCol);
  g.clearRect(l.x,l.y,l.x+l.w-1,l.y+l.h-1);
};

exports = Layout;