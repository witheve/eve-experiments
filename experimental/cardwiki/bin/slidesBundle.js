(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
// CodeMirror, copyright (c) by Marijn Haverbeke and others
// Distributed under an MIT license: http://codemirror.net/LICENSE

// This is CodeMirror (http://codemirror.net), a code editor
// implemented in JavaScript on top of the browser's DOM.
//
// You can find some technical background for some of the code below
// at http://marijnhaverbeke.nl/blog/#cm-internals .

(function(mod) {
  if (typeof exports == "object" && typeof module == "object") // CommonJS
    module.exports = mod();
  else if (typeof define == "function" && define.amd) // AMD
    return define([], mod);
  else // Plain browser env
    this.CodeMirror = mod();
})(function() {
  "use strict";

  // BROWSER SNIFFING

  // Kludges for bugs and behavior differences that can't be feature
  // detected are enabled based on userAgent etc sniffing.
  var userAgent = navigator.userAgent;
  var platform = navigator.platform;

  var gecko = /gecko\/\d/i.test(userAgent);
  var ie_upto10 = /MSIE \d/.test(userAgent);
  var ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(userAgent);
  var ie = ie_upto10 || ie_11up;
  var ie_version = ie && (ie_upto10 ? document.documentMode || 6 : ie_11up[1]);
  var webkit = /WebKit\//.test(userAgent);
  var qtwebkit = webkit && /Qt\/\d+\.\d+/.test(userAgent);
  var chrome = /Chrome\//.test(userAgent);
  var presto = /Opera\//.test(userAgent);
  var safari = /Apple Computer/.test(navigator.vendor);
  var mac_geMountainLion = /Mac OS X 1\d\D([8-9]|\d\d)\D/.test(userAgent);
  var phantom = /PhantomJS/.test(userAgent);

  var ios = /AppleWebKit/.test(userAgent) && /Mobile\/\w+/.test(userAgent);
  // This is woefully incomplete. Suggestions for alternative methods welcome.
  var mobile = ios || /Android|webOS|BlackBerry|Opera Mini|Opera Mobi|IEMobile/i.test(userAgent);
  var mac = ios || /Mac/.test(platform);
  var windows = /win/i.test(platform);

  var presto_version = presto && userAgent.match(/Version\/(\d*\.\d*)/);
  if (presto_version) presto_version = Number(presto_version[1]);
  if (presto_version && presto_version >= 15) { presto = false; webkit = true; }
  // Some browsers use the wrong event properties to signal cmd/ctrl on OS X
  var flipCtrlCmd = mac && (qtwebkit || presto && (presto_version == null || presto_version < 12.11));
  var captureRightClick = gecko || (ie && ie_version >= 9);

  // Optimize some code when these features are not used.
  var sawReadOnlySpans = false, sawCollapsedSpans = false;

  // EDITOR CONSTRUCTOR

  // A CodeMirror instance represents an editor. This is the object
  // that user code is usually dealing with.

  function CodeMirror(place, options) {
    if (!(this instanceof CodeMirror)) return new CodeMirror(place, options);

    this.options = options = options ? copyObj(options) : {};
    // Determine effective options based on given values and defaults.
    copyObj(defaults, options, false);
    setGuttersForLineNumbers(options);

    var doc = options.value;
    if (typeof doc == "string") doc = new Doc(doc, options.mode, null, options.lineSeparator);
    this.doc = doc;

    var input = new CodeMirror.inputStyles[options.inputStyle](this);
    var display = this.display = new Display(place, doc, input);
    display.wrapper.CodeMirror = this;
    updateGutters(this);
    themeChanged(this);
    if (options.lineWrapping)
      this.display.wrapper.className += " CodeMirror-wrap";
    if (options.autofocus && !mobile) display.input.focus();
    initScrollbars(this);

    this.state = {
      keyMaps: [],  // stores maps added by addKeyMap
      overlays: [], // highlighting overlays, as added by addOverlay
      modeGen: 0,   // bumped when mode/overlay changes, used to invalidate highlighting info
      overwrite: false,
      delayingBlurEvent: false,
      focused: false,
      suppressEdits: false, // used to disable editing during key handlers when in readOnly mode
      pasteIncoming: false, cutIncoming: false, // help recognize paste/cut edits in input.poll
      selectingText: false,
      draggingText: false,
      highlight: new Delayed(), // stores highlight worker timeout
      keySeq: null,  // Unfinished key sequence
      specialChars: null
    };

    var cm = this;

    // Override magic textarea content restore that IE sometimes does
    // on our hidden textarea on reload
    if (ie && ie_version < 11) setTimeout(function() { cm.display.input.reset(true); }, 20);

    registerEventHandlers(this);
    ensureGlobalHandlers();

    startOperation(this);
    this.curOp.forceUpdate = true;
    attachDoc(this, doc);

    if ((options.autofocus && !mobile) || cm.hasFocus())
      setTimeout(bind(onFocus, this), 20);
    else
      onBlur(this);

    for (var opt in optionHandlers) if (optionHandlers.hasOwnProperty(opt))
      optionHandlers[opt](this, options[opt], Init);
    maybeUpdateLineNumberWidth(this);
    if (options.finishInit) options.finishInit(this);
    for (var i = 0; i < initHooks.length; ++i) initHooks[i](this);
    endOperation(this);
    // Suppress optimizelegibility in Webkit, since it breaks text
    // measuring on line wrapping boundaries.
    if (webkit && options.lineWrapping &&
        getComputedStyle(display.lineDiv).textRendering == "optimizelegibility")
      display.lineDiv.style.textRendering = "auto";
  }

  // DISPLAY CONSTRUCTOR

  // The display handles the DOM integration, both for input reading
  // and content drawing. It holds references to DOM nodes and
  // display-related state.

  function Display(place, doc, input) {
    var d = this;
    this.input = input;

    // Covers bottom-right square when both scrollbars are present.
    d.scrollbarFiller = elt("div", null, "CodeMirror-scrollbar-filler");
    d.scrollbarFiller.setAttribute("cm-not-content", "true");
    // Covers bottom of gutter when coverGutterNextToScrollbar is on
    // and h scrollbar is present.
    d.gutterFiller = elt("div", null, "CodeMirror-gutter-filler");
    d.gutterFiller.setAttribute("cm-not-content", "true");
    // Will contain the actual code, positioned to cover the viewport.
    d.lineDiv = elt("div", null, "CodeMirror-code");
    // Elements are added to these to represent selection and cursors.
    d.selectionDiv = elt("div", null, null, "position: relative; z-index: 1");
    d.cursorDiv = elt("div", null, "CodeMirror-cursors");
    // A visibility: hidden element used to find the size of things.
    d.measure = elt("div", null, "CodeMirror-measure");
    // When lines outside of the viewport are measured, they are drawn in this.
    d.lineMeasure = elt("div", null, "CodeMirror-measure");
    // Wraps everything that needs to exist inside the vertically-padded coordinate system
    d.lineSpace = elt("div", [d.measure, d.lineMeasure, d.selectionDiv, d.cursorDiv, d.lineDiv],
                      null, "position: relative; outline: none");
    // Moved around its parent to cover visible view.
    d.mover = elt("div", [elt("div", [d.lineSpace], "CodeMirror-lines")], null, "position: relative");
    // Set to the height of the document, allowing scrolling.
    d.sizer = elt("div", [d.mover], "CodeMirror-sizer");
    d.sizerWidth = null;
    // Behavior of elts with overflow: auto and padding is
    // inconsistent across browsers. This is used to ensure the
    // scrollable area is big enough.
    d.heightForcer = elt("div", null, null, "position: absolute; height: " + scrollerGap + "px; width: 1px;");
    // Will contain the gutters, if any.
    d.gutters = elt("div", null, "CodeMirror-gutters");
    d.lineGutter = null;
    // Actual scrollable element.
    d.scroller = elt("div", [d.sizer, d.heightForcer, d.gutters], "CodeMirror-scroll");
    d.scroller.setAttribute("tabIndex", "-1");
    // The element in which the editor lives.
    d.wrapper = elt("div", [d.scrollbarFiller, d.gutterFiller, d.scroller], "CodeMirror");

    // Work around IE7 z-index bug (not perfect, hence IE7 not really being supported)
    if (ie && ie_version < 8) { d.gutters.style.zIndex = -1; d.scroller.style.paddingRight = 0; }
    if (!webkit && !(gecko && mobile)) d.scroller.draggable = true;

    if (place) {
      if (place.appendChild) place.appendChild(d.wrapper);
      else place(d.wrapper);
    }

    // Current rendered range (may be bigger than the view window).
    d.viewFrom = d.viewTo = doc.first;
    d.reportedViewFrom = d.reportedViewTo = doc.first;
    // Information about the rendered lines.
    d.view = [];
    d.renderedView = null;
    // Holds info about a single rendered line when it was rendered
    // for measurement, while not in view.
    d.externalMeasured = null;
    // Empty space (in pixels) above the view
    d.viewOffset = 0;
    d.lastWrapHeight = d.lastWrapWidth = 0;
    d.updateLineNumbers = null;

    d.nativeBarWidth = d.barHeight = d.barWidth = 0;
    d.scrollbarsClipped = false;

    // Used to only resize the line number gutter when necessary (when
    // the amount of lines crosses a boundary that makes its width change)
    d.lineNumWidth = d.lineNumInnerWidth = d.lineNumChars = null;
    // Set to true when a non-horizontal-scrolling line widget is
    // added. As an optimization, line widget aligning is skipped when
    // this is false.
    d.alignWidgets = false;

    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;

    // Tracks the maximum line length so that the horizontal scrollbar
    // can be kept static when scrolling.
    d.maxLine = null;
    d.maxLineLength = 0;
    d.maxLineChanged = false;

    // Used for measuring wheel scrolling granularity
    d.wheelDX = d.wheelDY = d.wheelStartX = d.wheelStartY = null;

    // True when shift is held down.
    d.shift = false;

    // Used to track whether anything happened since the context menu
    // was opened.
    d.selForContextMenu = null;

    d.activeTouch = null;

    input.init(d);
  }

  // STATE UPDATES

  // Used to get the editor into a consistent state again when options change.

  function loadMode(cm) {
    cm.doc.mode = CodeMirror.getMode(cm.options, cm.doc.modeOption);
    resetModeState(cm);
  }

  function resetModeState(cm) {
    cm.doc.iter(function(line) {
      if (line.stateAfter) line.stateAfter = null;
      if (line.styles) line.styles = null;
    });
    cm.doc.frontier = cm.doc.first;
    startWorker(cm, 100);
    cm.state.modeGen++;
    if (cm.curOp) regChange(cm);
  }

  function wrappingChanged(cm) {
    if (cm.options.lineWrapping) {
      addClass(cm.display.wrapper, "CodeMirror-wrap");
      cm.display.sizer.style.minWidth = "";
      cm.display.sizerWidth = null;
    } else {
      rmClass(cm.display.wrapper, "CodeMirror-wrap");
      findMaxLine(cm);
    }
    estimateLineHeights(cm);
    regChange(cm);
    clearCaches(cm);
    setTimeout(function(){updateScrollbars(cm);}, 100);
  }

  // Returns a function that estimates the height of a line, to use as
  // first approximation until the line becomes visible (and is thus
  // properly measurable).
  function estimateHeight(cm) {
    var th = textHeight(cm.display), wrapping = cm.options.lineWrapping;
    var perLine = wrapping && Math.max(5, cm.display.scroller.clientWidth / charWidth(cm.display) - 3);
    return function(line) {
      if (lineIsHidden(cm.doc, line)) return 0;

      var widgetsHeight = 0;
      if (line.widgets) for (var i = 0; i < line.widgets.length; i++) {
        if (line.widgets[i].height) widgetsHeight += line.widgets[i].height;
      }

      if (wrapping)
        return widgetsHeight + (Math.ceil(line.text.length / perLine) || 1) * th;
      else
        return widgetsHeight + th;
    };
  }

  function estimateLineHeights(cm) {
    var doc = cm.doc, est = estimateHeight(cm);
    doc.iter(function(line) {
      var estHeight = est(line);
      if (estHeight != line.height) updateLineHeight(line, estHeight);
    });
  }

  function themeChanged(cm) {
    cm.display.wrapper.className = cm.display.wrapper.className.replace(/\s*cm-s-\S+/g, "") +
      cm.options.theme.replace(/(^|\s)\s*/g, " cm-s-");
    clearCaches(cm);
  }

  function guttersChanged(cm) {
    updateGutters(cm);
    regChange(cm);
    setTimeout(function(){alignHorizontally(cm);}, 20);
  }

  // Rebuild the gutter elements, ensure the margin to the left of the
  // code matches their width.
  function updateGutters(cm) {
    var gutters = cm.display.gutters, specs = cm.options.gutters;
    removeChildren(gutters);
    for (var i = 0; i < specs.length; ++i) {
      var gutterClass = specs[i];
      var gElt = gutters.appendChild(elt("div", null, "CodeMirror-gutter " + gutterClass));
      if (gutterClass == "CodeMirror-linenumbers") {
        cm.display.lineGutter = gElt;
        gElt.style.width = (cm.display.lineNumWidth || 1) + "px";
      }
    }
    gutters.style.display = i ? "" : "none";
    updateGutterSpace(cm);
  }

  function updateGutterSpace(cm) {
    var width = cm.display.gutters.offsetWidth;
    cm.display.sizer.style.marginLeft = width + "px";
  }

  // Compute the character length of a line, taking into account
  // collapsed ranges (see markText) that might hide parts, and join
  // other lines onto it.
  function lineLength(line) {
    if (line.height == 0) return 0;
    var len = line.text.length, merged, cur = line;
    while (merged = collapsedSpanAtStart(cur)) {
      var found = merged.find(0, true);
      cur = found.from.line;
      len += found.from.ch - found.to.ch;
    }
    cur = line;
    while (merged = collapsedSpanAtEnd(cur)) {
      var found = merged.find(0, true);
      len -= cur.text.length - found.from.ch;
      cur = found.to.line;
      len += cur.text.length - found.to.ch;
    }
    return len;
  }

  // Find the longest line in the document.
  function findMaxLine(cm) {
    var d = cm.display, doc = cm.doc;
    d.maxLine = getLine(doc, doc.first);
    d.maxLineLength = lineLength(d.maxLine);
    d.maxLineChanged = true;
    doc.iter(function(line) {
      var len = lineLength(line);
      if (len > d.maxLineLength) {
        d.maxLineLength = len;
        d.maxLine = line;
      }
    });
  }

  // Make sure the gutters options contains the element
  // "CodeMirror-linenumbers" when the lineNumbers option is true.
  function setGuttersForLineNumbers(options) {
    var found = indexOf(options.gutters, "CodeMirror-linenumbers");
    if (found == -1 && options.lineNumbers) {
      options.gutters = options.gutters.concat(["CodeMirror-linenumbers"]);
    } else if (found > -1 && !options.lineNumbers) {
      options.gutters = options.gutters.slice(0);
      options.gutters.splice(found, 1);
    }
  }

  // SCROLLBARS

  // Prepare DOM reads needed to update the scrollbars. Done in one
  // shot to minimize update/measure roundtrips.
  function measureForScrollbars(cm) {
    var d = cm.display, gutterW = d.gutters.offsetWidth;
    var docH = Math.round(cm.doc.height + paddingVert(cm.display));
    return {
      clientHeight: d.scroller.clientHeight,
      viewHeight: d.wrapper.clientHeight,
      scrollWidth: d.scroller.scrollWidth, clientWidth: d.scroller.clientWidth,
      viewWidth: d.wrapper.clientWidth,
      barLeft: cm.options.fixedGutter ? gutterW : 0,
      docHeight: docH,
      scrollHeight: docH + scrollGap(cm) + d.barHeight,
      nativeBarWidth: d.nativeBarWidth,
      gutterWidth: gutterW
    };
  }

  function NativeScrollbars(place, scroll, cm) {
    this.cm = cm;
    var vert = this.vert = elt("div", [elt("div", null, null, "min-width: 1px")], "CodeMirror-vscrollbar");
    var horiz = this.horiz = elt("div", [elt("div", null, null, "height: 100%; min-height: 1px")], "CodeMirror-hscrollbar");
    place(vert); place(horiz);

    on(vert, "scroll", function() {
      if (vert.clientHeight) scroll(vert.scrollTop, "vertical");
    });
    on(horiz, "scroll", function() {
      if (horiz.clientWidth) scroll(horiz.scrollLeft, "horizontal");
    });

    this.checkedOverlay = false;
    // Need to set a minimum width to see the scrollbar on IE7 (but must not set it on IE8).
    if (ie && ie_version < 8) this.horiz.style.minHeight = this.vert.style.minWidth = "18px";
  }

  NativeScrollbars.prototype = copyObj({
    update: function(measure) {
      var needsH = measure.scrollWidth > measure.clientWidth + 1;
      var needsV = measure.scrollHeight > measure.clientHeight + 1;
      var sWidth = measure.nativeBarWidth;

      if (needsV) {
        this.vert.style.display = "block";
        this.vert.style.bottom = needsH ? sWidth + "px" : "0";
        var totalHeight = measure.viewHeight - (needsH ? sWidth : 0);
        // A bug in IE8 can cause this value to be negative, so guard it.
        this.vert.firstChild.style.height =
          Math.max(0, measure.scrollHeight - measure.clientHeight + totalHeight) + "px";
      } else {
        this.vert.style.display = "";
        this.vert.firstChild.style.height = "0";
      }

      if (needsH) {
        this.horiz.style.display = "block";
        this.horiz.style.right = needsV ? sWidth + "px" : "0";
        this.horiz.style.left = measure.barLeft + "px";
        var totalWidth = measure.viewWidth - measure.barLeft - (needsV ? sWidth : 0);
        this.horiz.firstChild.style.width =
          (measure.scrollWidth - measure.clientWidth + totalWidth) + "px";
      } else {
        this.horiz.style.display = "";
        this.horiz.firstChild.style.width = "0";
      }

      if (!this.checkedOverlay && measure.clientHeight > 0) {
        if (sWidth == 0) this.overlayHack();
        this.checkedOverlay = true;
      }

      return {right: needsV ? sWidth : 0, bottom: needsH ? sWidth : 0};
    },
    setScrollLeft: function(pos) {
      if (this.horiz.scrollLeft != pos) this.horiz.scrollLeft = pos;
    },
    setScrollTop: function(pos) {
      if (this.vert.scrollTop != pos) this.vert.scrollTop = pos;
    },
    overlayHack: function() {
      var w = mac && !mac_geMountainLion ? "12px" : "18px";
      this.horiz.style.minHeight = this.vert.style.minWidth = w;
      var self = this;
      var barMouseDown = function(e) {
        if (e_target(e) != self.vert && e_target(e) != self.horiz)
          operation(self.cm, onMouseDown)(e);
      };
      on(this.vert, "mousedown", barMouseDown);
      on(this.horiz, "mousedown", barMouseDown);
    },
    clear: function() {
      var parent = this.horiz.parentNode;
      parent.removeChild(this.horiz);
      parent.removeChild(this.vert);
    }
  }, NativeScrollbars.prototype);

  function NullScrollbars() {}

  NullScrollbars.prototype = copyObj({
    update: function() { return {bottom: 0, right: 0}; },
    setScrollLeft: function() {},
    setScrollTop: function() {},
    clear: function() {}
  }, NullScrollbars.prototype);

  CodeMirror.scrollbarModel = {"native": NativeScrollbars, "null": NullScrollbars};

  function initScrollbars(cm) {
    if (cm.display.scrollbars) {
      cm.display.scrollbars.clear();
      if (cm.display.scrollbars.addClass)
        rmClass(cm.display.wrapper, cm.display.scrollbars.addClass);
    }

    cm.display.scrollbars = new CodeMirror.scrollbarModel[cm.options.scrollbarStyle](function(node) {
      cm.display.wrapper.insertBefore(node, cm.display.scrollbarFiller);
      // Prevent clicks in the scrollbars from killing focus
      on(node, "mousedown", function() {
        if (cm.state.focused) setTimeout(function() { cm.display.input.focus(); }, 0);
      });
      node.setAttribute("cm-not-content", "true");
    }, function(pos, axis) {
      if (axis == "horizontal") setScrollLeft(cm, pos);
      else setScrollTop(cm, pos);
    }, cm);
    if (cm.display.scrollbars.addClass)
      addClass(cm.display.wrapper, cm.display.scrollbars.addClass);
  }

  function updateScrollbars(cm, measure) {
    if (!measure) measure = measureForScrollbars(cm);
    var startWidth = cm.display.barWidth, startHeight = cm.display.barHeight;
    updateScrollbarsInner(cm, measure);
    for (var i = 0; i < 4 && startWidth != cm.display.barWidth || startHeight != cm.display.barHeight; i++) {
      if (startWidth != cm.display.barWidth && cm.options.lineWrapping)
        updateHeightsInViewport(cm);
      updateScrollbarsInner(cm, measureForScrollbars(cm));
      startWidth = cm.display.barWidth; startHeight = cm.display.barHeight;
    }
  }

  // Re-synchronize the fake scrollbars with the actual size of the
  // content.
  function updateScrollbarsInner(cm, measure) {
    var d = cm.display;
    var sizes = d.scrollbars.update(measure);

    d.sizer.style.paddingRight = (d.barWidth = sizes.right) + "px";
    d.sizer.style.paddingBottom = (d.barHeight = sizes.bottom) + "px";

    if (sizes.right && sizes.bottom) {
      d.scrollbarFiller.style.display = "block";
      d.scrollbarFiller.style.height = sizes.bottom + "px";
      d.scrollbarFiller.style.width = sizes.right + "px";
    } else d.scrollbarFiller.style.display = "";
    if (sizes.bottom && cm.options.coverGutterNextToScrollbar && cm.options.fixedGutter) {
      d.gutterFiller.style.display = "block";
      d.gutterFiller.style.height = sizes.bottom + "px";
      d.gutterFiller.style.width = measure.gutterWidth + "px";
    } else d.gutterFiller.style.display = "";
  }

  // Compute the lines that are visible in a given viewport (defaults
  // the the current scroll position). viewport may contain top,
  // height, and ensure (see op.scrollToPos) properties.
  function visibleLines(display, doc, viewport) {
    var top = viewport && viewport.top != null ? Math.max(0, viewport.top) : display.scroller.scrollTop;
    top = Math.floor(top - paddingTop(display));
    var bottom = viewport && viewport.bottom != null ? viewport.bottom : top + display.wrapper.clientHeight;

    var from = lineAtHeight(doc, top), to = lineAtHeight(doc, bottom);
    // Ensure is a {from: {line, ch}, to: {line, ch}} object, and
    // forces those lines into the viewport (if possible).
    if (viewport && viewport.ensure) {
      var ensureFrom = viewport.ensure.from.line, ensureTo = viewport.ensure.to.line;
      if (ensureFrom < from) {
        from = ensureFrom;
        to = lineAtHeight(doc, heightAtLine(getLine(doc, ensureFrom)) + display.wrapper.clientHeight);
      } else if (Math.min(ensureTo, doc.lastLine()) >= to) {
        from = lineAtHeight(doc, heightAtLine(getLine(doc, ensureTo)) - display.wrapper.clientHeight);
        to = ensureTo;
      }
    }
    return {from: from, to: Math.max(to, from + 1)};
  }

  // LINE NUMBERS

  // Re-align line numbers and gutter marks to compensate for
  // horizontal scrolling.
  function alignHorizontally(cm) {
    var display = cm.display, view = display.view;
    if (!display.alignWidgets && (!display.gutters.firstChild || !cm.options.fixedGutter)) return;
    var comp = compensateForHScroll(display) - display.scroller.scrollLeft + cm.doc.scrollLeft;
    var gutterW = display.gutters.offsetWidth, left = comp + "px";
    for (var i = 0; i < view.length; i++) if (!view[i].hidden) {
      if (cm.options.fixedGutter && view[i].gutter)
        view[i].gutter.style.left = left;
      var align = view[i].alignable;
      if (align) for (var j = 0; j < align.length; j++)
        align[j].style.left = left;
    }
    if (cm.options.fixedGutter)
      display.gutters.style.left = (comp + gutterW) + "px";
  }

  // Used to ensure that the line number gutter is still the right
  // size for the current document size. Returns true when an update
  // is needed.
  function maybeUpdateLineNumberWidth(cm) {
    if (!cm.options.lineNumbers) return false;
    var doc = cm.doc, last = lineNumberFor(cm.options, doc.first + doc.size - 1), display = cm.display;
    if (last.length != display.lineNumChars) {
      var test = display.measure.appendChild(elt("div", [elt("div", last)],
                                                 "CodeMirror-linenumber CodeMirror-gutter-elt"));
      var innerW = test.firstChild.offsetWidth, padding = test.offsetWidth - innerW;
      display.lineGutter.style.width = "";
      display.lineNumInnerWidth = Math.max(innerW, display.lineGutter.offsetWidth - padding) + 1;
      display.lineNumWidth = display.lineNumInnerWidth + padding;
      display.lineNumChars = display.lineNumInnerWidth ? last.length : -1;
      display.lineGutter.style.width = display.lineNumWidth + "px";
      updateGutterSpace(cm);
      return true;
    }
    return false;
  }

  function lineNumberFor(options, i) {
    return String(options.lineNumberFormatter(i + options.firstLineNumber));
  }

  // Computes display.scroller.scrollLeft + display.gutters.offsetWidth,
  // but using getBoundingClientRect to get a sub-pixel-accurate
  // result.
  function compensateForHScroll(display) {
    return display.scroller.getBoundingClientRect().left - display.sizer.getBoundingClientRect().left;
  }

  // DISPLAY DRAWING

  function DisplayUpdate(cm, viewport, force) {
    var display = cm.display;

    this.viewport = viewport;
    // Store some values that we'll need later (but don't want to force a relayout for)
    this.visible = visibleLines(display, cm.doc, viewport);
    this.editorIsHidden = !display.wrapper.offsetWidth;
    this.wrapperHeight = display.wrapper.clientHeight;
    this.wrapperWidth = display.wrapper.clientWidth;
    this.oldDisplayWidth = displayWidth(cm);
    this.force = force;
    this.dims = getDimensions(cm);
    this.events = [];
  }

  DisplayUpdate.prototype.signal = function(emitter, type) {
    if (hasHandler(emitter, type))
      this.events.push(arguments);
  };
  DisplayUpdate.prototype.finish = function() {
    for (var i = 0; i < this.events.length; i++)
      signal.apply(null, this.events[i]);
  };

  function maybeClipScrollbars(cm) {
    var display = cm.display;
    if (!display.scrollbarsClipped && display.scroller.offsetWidth) {
      display.nativeBarWidth = display.scroller.offsetWidth - display.scroller.clientWidth;
      display.heightForcer.style.height = scrollGap(cm) + "px";
      display.sizer.style.marginBottom = -display.nativeBarWidth + "px";
      display.sizer.style.borderRightWidth = scrollGap(cm) + "px";
      display.scrollbarsClipped = true;
    }
  }

  // Does the actual updating of the line display. Bails out
  // (returning false) when there is nothing to be done and forced is
  // false.
  function updateDisplayIfNeeded(cm, update) {
    var display = cm.display, doc = cm.doc;

    if (update.editorIsHidden) {
      resetView(cm);
      return false;
    }

    // Bail out if the visible area is already rendered and nothing changed.
    if (!update.force &&
        update.visible.from >= display.viewFrom && update.visible.to <= display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo) &&
        display.renderedView == display.view && countDirtyView(cm) == 0)
      return false;

    if (maybeUpdateLineNumberWidth(cm)) {
      resetView(cm);
      update.dims = getDimensions(cm);
    }

    // Compute a suitable new viewport (from & to)
    var end = doc.first + doc.size;
    var from = Math.max(update.visible.from - cm.options.viewportMargin, doc.first);
    var to = Math.min(end, update.visible.to + cm.options.viewportMargin);
    if (display.viewFrom < from && from - display.viewFrom < 20) from = Math.max(doc.first, display.viewFrom);
    if (display.viewTo > to && display.viewTo - to < 20) to = Math.min(end, display.viewTo);
    if (sawCollapsedSpans) {
      from = visualLineNo(cm.doc, from);
      to = visualLineEndNo(cm.doc, to);
    }

    var different = from != display.viewFrom || to != display.viewTo ||
      display.lastWrapHeight != update.wrapperHeight || display.lastWrapWidth != update.wrapperWidth;
    adjustView(cm, from, to);

    display.viewOffset = heightAtLine(getLine(cm.doc, display.viewFrom));
    // Position the mover div to align with the current scroll position
    cm.display.mover.style.top = display.viewOffset + "px";

    var toUpdate = countDirtyView(cm);
    if (!different && toUpdate == 0 && !update.force && display.renderedView == display.view &&
        (display.updateLineNumbers == null || display.updateLineNumbers >= display.viewTo))
      return false;

    // For big changes, we hide the enclosing element during the
    // update, since that speeds up the operations on most browsers.
    var focused = activeElt();
    if (toUpdate > 4) display.lineDiv.style.display = "none";
    patchDisplay(cm, display.updateLineNumbers, update.dims);
    if (toUpdate > 4) display.lineDiv.style.display = "";
    display.renderedView = display.view;
    // There might have been a widget with a focused element that got
    // hidden or updated, if so re-focus it.
    if (focused && activeElt() != focused && focused.offsetHeight) focused.focus();

    // Prevent selection and cursors from interfering with the scroll
    // width and height.
    removeChildren(display.cursorDiv);
    removeChildren(display.selectionDiv);
    display.gutters.style.height = display.sizer.style.minHeight = 0;

    if (different) {
      display.lastWrapHeight = update.wrapperHeight;
      display.lastWrapWidth = update.wrapperWidth;
      startWorker(cm, 400);
    }

    display.updateLineNumbers = null;

    return true;
  }

  function postUpdateDisplay(cm, update) {
    var viewport = update.viewport;
    for (var first = true;; first = false) {
      if (!first || !cm.options.lineWrapping || update.oldDisplayWidth == displayWidth(cm)) {
        // Clip forced viewport to actual scrollable area.
        if (viewport && viewport.top != null)
          viewport = {top: Math.min(cm.doc.height + paddingVert(cm.display) - displayHeight(cm), viewport.top)};
        // Updated line heights might result in the drawn area not
        // actually covering the viewport. Keep looping until it does.
        update.visible = visibleLines(cm.display, cm.doc, viewport);
        if (update.visible.from >= cm.display.viewFrom && update.visible.to <= cm.display.viewTo)
          break;
      }
      if (!updateDisplayIfNeeded(cm, update)) break;
      updateHeightsInViewport(cm);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
    }

    update.signal(cm, "update", cm);
    if (cm.display.viewFrom != cm.display.reportedViewFrom || cm.display.viewTo != cm.display.reportedViewTo) {
      update.signal(cm, "viewportChange", cm, cm.display.viewFrom, cm.display.viewTo);
      cm.display.reportedViewFrom = cm.display.viewFrom; cm.display.reportedViewTo = cm.display.viewTo;
    }
  }

  function updateDisplaySimple(cm, viewport) {
    var update = new DisplayUpdate(cm, viewport);
    if (updateDisplayIfNeeded(cm, update)) {
      updateHeightsInViewport(cm);
      postUpdateDisplay(cm, update);
      var barMeasure = measureForScrollbars(cm);
      updateSelection(cm);
      setDocumentHeight(cm, barMeasure);
      updateScrollbars(cm, barMeasure);
      update.finish();
    }
  }

  function setDocumentHeight(cm, measure) {
    cm.display.sizer.style.minHeight = measure.docHeight + "px";
    var total = measure.docHeight + cm.display.barHeight;
    cm.display.heightForcer.style.top = total + "px";
    cm.display.gutters.style.height = Math.max(total + scrollGap(cm), measure.clientHeight) + "px";
  }

  // Read the actual heights of the rendered lines, and update their
  // stored heights to match.
  function updateHeightsInViewport(cm) {
    var display = cm.display;
    var prevBottom = display.lineDiv.offsetTop;
    for (var i = 0; i < display.view.length; i++) {
      var cur = display.view[i], height;
      if (cur.hidden) continue;
      if (ie && ie_version < 8) {
        var bot = cur.node.offsetTop + cur.node.offsetHeight;
        height = bot - prevBottom;
        prevBottom = bot;
      } else {
        var box = cur.node.getBoundingClientRect();
        height = box.bottom - box.top;
      }
      var diff = cur.line.height - height;
      if (height < 2) height = textHeight(display);
      if (diff > .001 || diff < -.001) {
        updateLineHeight(cur.line, height);
        updateWidgetHeight(cur.line);
        if (cur.rest) for (var j = 0; j < cur.rest.length; j++)
          updateWidgetHeight(cur.rest[j]);
      }
    }
  }

  // Read and store the height of line widgets associated with the
  // given line.
  function updateWidgetHeight(line) {
    if (line.widgets) for (var i = 0; i < line.widgets.length; ++i)
      line.widgets[i].height = line.widgets[i].node.offsetHeight;
  }

  // Do a bulk-read of the DOM positions and sizes needed to draw the
  // view, so that we don't interleave reading and writing to the DOM.
  function getDimensions(cm) {
    var d = cm.display, left = {}, width = {};
    var gutterLeft = d.gutters.clientLeft;
    for (var n = d.gutters.firstChild, i = 0; n; n = n.nextSibling, ++i) {
      left[cm.options.gutters[i]] = n.offsetLeft + n.clientLeft + gutterLeft;
      width[cm.options.gutters[i]] = n.clientWidth;
    }
    return {fixedPos: compensateForHScroll(d),
            gutterTotalWidth: d.gutters.offsetWidth,
            gutterLeft: left,
            gutterWidth: width,
            wrapperWidth: d.wrapper.clientWidth};
  }

  // Sync the actual display DOM structure with display.view, removing
  // nodes for lines that are no longer in view, and creating the ones
  // that are not there yet, and updating the ones that are out of
  // date.
  function patchDisplay(cm, updateNumbersFrom, dims) {
    var display = cm.display, lineNumbers = cm.options.lineNumbers;
    var container = display.lineDiv, cur = container.firstChild;

    function rm(node) {
      var next = node.nextSibling;
      // Works around a throw-scroll bug in OS X Webkit
      if (webkit && mac && cm.display.currentWheelTarget == node)
        node.style.display = "none";
      else
        node.parentNode.removeChild(node);
      return next;
    }

    var view = display.view, lineN = display.viewFrom;
    // Loop over the elements in the view, syncing cur (the DOM nodes
    // in display.lineDiv) with the view as we go.
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (lineView.hidden) {
      } else if (!lineView.node || lineView.node.parentNode != container) { // Not drawn yet
        var node = buildLineElement(cm, lineView, lineN, dims);
        container.insertBefore(node, cur);
      } else { // Already drawn
        while (cur != lineView.node) cur = rm(cur);
        var updateNumber = lineNumbers && updateNumbersFrom != null &&
          updateNumbersFrom <= lineN && lineView.lineNumber;
        if (lineView.changes) {
          if (indexOf(lineView.changes, "gutter") > -1) updateNumber = false;
          updateLineForChanges(cm, lineView, lineN, dims);
        }
        if (updateNumber) {
          removeChildren(lineView.lineNumber);
          lineView.lineNumber.appendChild(document.createTextNode(lineNumberFor(cm.options, lineN)));
        }
        cur = lineView.node.nextSibling;
      }
      lineN += lineView.size;
    }
    while (cur) cur = rm(cur);
  }

  // When an aspect of a line changes, a string is added to
  // lineView.changes. This updates the relevant part of the line's
  // DOM structure.
  function updateLineForChanges(cm, lineView, lineN, dims) {
    for (var j = 0; j < lineView.changes.length; j++) {
      var type = lineView.changes[j];
      if (type == "text") updateLineText(cm, lineView);
      else if (type == "gutter") updateLineGutter(cm, lineView, lineN, dims);
      else if (type == "class") updateLineClasses(lineView);
      else if (type == "widget") updateLineWidgets(cm, lineView, dims);
    }
    lineView.changes = null;
  }

  // Lines with gutter elements, widgets or a background class need to
  // be wrapped, and have the extra elements added to the wrapper div
  function ensureLineWrapped(lineView) {
    if (lineView.node == lineView.text) {
      lineView.node = elt("div", null, null, "position: relative");
      if (lineView.text.parentNode)
        lineView.text.parentNode.replaceChild(lineView.node, lineView.text);
      lineView.node.appendChild(lineView.text);
      if (ie && ie_version < 8) lineView.node.style.zIndex = 2;
    }
    return lineView.node;
  }

  function updateLineBackground(lineView) {
    var cls = lineView.bgClass ? lineView.bgClass + " " + (lineView.line.bgClass || "") : lineView.line.bgClass;
    if (cls) cls += " CodeMirror-linebackground";
    if (lineView.background) {
      if (cls) lineView.background.className = cls;
      else { lineView.background.parentNode.removeChild(lineView.background); lineView.background = null; }
    } else if (cls) {
      var wrap = ensureLineWrapped(lineView);
      lineView.background = wrap.insertBefore(elt("div", null, cls), wrap.firstChild);
    }
  }

  // Wrapper around buildLineContent which will reuse the structure
  // in display.externalMeasured when possible.
  function getLineContent(cm, lineView) {
    var ext = cm.display.externalMeasured;
    if (ext && ext.line == lineView.line) {
      cm.display.externalMeasured = null;
      lineView.measure = ext.measure;
      return ext.built;
    }
    return buildLineContent(cm, lineView);
  }

  // Redraw the line's text. Interacts with the background and text
  // classes because the mode may output tokens that influence these
  // classes.
  function updateLineText(cm, lineView) {
    var cls = lineView.text.className;
    var built = getLineContent(cm, lineView);
    if (lineView.text == lineView.node) lineView.node = built.pre;
    lineView.text.parentNode.replaceChild(built.pre, lineView.text);
    lineView.text = built.pre;
    if (built.bgClass != lineView.bgClass || built.textClass != lineView.textClass) {
      lineView.bgClass = built.bgClass;
      lineView.textClass = built.textClass;
      updateLineClasses(lineView);
    } else if (cls) {
      lineView.text.className = cls;
    }
  }

  function updateLineClasses(lineView) {
    updateLineBackground(lineView);
    if (lineView.line.wrapClass)
      ensureLineWrapped(lineView).className = lineView.line.wrapClass;
    else if (lineView.node != lineView.text)
      lineView.node.className = "";
    var textClass = lineView.textClass ? lineView.textClass + " " + (lineView.line.textClass || "") : lineView.line.textClass;
    lineView.text.className = textClass || "";
  }

  function updateLineGutter(cm, lineView, lineN, dims) {
    if (lineView.gutter) {
      lineView.node.removeChild(lineView.gutter);
      lineView.gutter = null;
    }
    if (lineView.gutterBackground) {
      lineView.node.removeChild(lineView.gutterBackground);
      lineView.gutterBackground = null;
    }
    if (lineView.line.gutterClass) {
      var wrap = ensureLineWrapped(lineView);
      lineView.gutterBackground = elt("div", null, "CodeMirror-gutter-background " + lineView.line.gutterClass,
                                      "left: " + (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) +
                                      "px; width: " + dims.gutterTotalWidth + "px");
      wrap.insertBefore(lineView.gutterBackground, lineView.text);
    }
    var markers = lineView.line.gutterMarkers;
    if (cm.options.lineNumbers || markers) {
      var wrap = ensureLineWrapped(lineView);
      var gutterWrap = lineView.gutter = elt("div", null, "CodeMirror-gutter-wrapper", "left: " +
                                             (cm.options.fixedGutter ? dims.fixedPos : -dims.gutterTotalWidth) + "px");
      cm.display.input.setUneditable(gutterWrap);
      wrap.insertBefore(gutterWrap, lineView.text);
      if (lineView.line.gutterClass)
        gutterWrap.className += " " + lineView.line.gutterClass;
      if (cm.options.lineNumbers && (!markers || !markers["CodeMirror-linenumbers"]))
        lineView.lineNumber = gutterWrap.appendChild(
          elt("div", lineNumberFor(cm.options, lineN),
              "CodeMirror-linenumber CodeMirror-gutter-elt",
              "left: " + dims.gutterLeft["CodeMirror-linenumbers"] + "px; width: "
              + cm.display.lineNumInnerWidth + "px"));
      if (markers) for (var k = 0; k < cm.options.gutters.length; ++k) {
        var id = cm.options.gutters[k], found = markers.hasOwnProperty(id) && markers[id];
        if (found)
          gutterWrap.appendChild(elt("div", [found], "CodeMirror-gutter-elt", "left: " +
                                     dims.gutterLeft[id] + "px; width: " + dims.gutterWidth[id] + "px"));
      }
    }
  }

  function updateLineWidgets(cm, lineView, dims) {
    if (lineView.alignable) lineView.alignable = null;
    for (var node = lineView.node.firstChild, next; node; node = next) {
      var next = node.nextSibling;
      if (node.className == "CodeMirror-linewidget")
        lineView.node.removeChild(node);
    }
    insertLineWidgets(cm, lineView, dims);
  }

  // Build a line's DOM representation from scratch
  function buildLineElement(cm, lineView, lineN, dims) {
    var built = getLineContent(cm, lineView);
    lineView.text = lineView.node = built.pre;
    if (built.bgClass) lineView.bgClass = built.bgClass;
    if (built.textClass) lineView.textClass = built.textClass;

    updateLineClasses(lineView);
    updateLineGutter(cm, lineView, lineN, dims);
    insertLineWidgets(cm, lineView, dims);
    return lineView.node;
  }

  // A lineView may contain multiple logical lines (when merged by
  // collapsed spans). The widgets for all of them need to be drawn.
  function insertLineWidgets(cm, lineView, dims) {
    insertLineWidgetsFor(cm, lineView.line, lineView, dims, true);
    if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
      insertLineWidgetsFor(cm, lineView.rest[i], lineView, dims, false);
  }

  function insertLineWidgetsFor(cm, line, lineView, dims, allowAbove) {
    if (!line.widgets) return;
    var wrap = ensureLineWrapped(lineView);
    for (var i = 0, ws = line.widgets; i < ws.length; ++i) {
      var widget = ws[i], node = elt("div", [widget.node], "CodeMirror-linewidget");
      if (!widget.handleMouseEvents) node.setAttribute("cm-ignore-events", "true");
      positionLineWidget(widget, node, lineView, dims);
      cm.display.input.setUneditable(node);
      if (allowAbove && widget.above)
        wrap.insertBefore(node, lineView.gutter || lineView.text);
      else
        wrap.appendChild(node);
      signalLater(widget, "redraw");
    }
  }

  function positionLineWidget(widget, node, lineView, dims) {
    if (widget.noHScroll) {
      (lineView.alignable || (lineView.alignable = [])).push(node);
      var width = dims.wrapperWidth;
      node.style.left = dims.fixedPos + "px";
      if (!widget.coverGutter) {
        width -= dims.gutterTotalWidth;
        node.style.paddingLeft = dims.gutterTotalWidth + "px";
      }
      node.style.width = width + "px";
    }
    if (widget.coverGutter) {
      node.style.zIndex = 5;
      node.style.position = "relative";
      if (!widget.noHScroll) node.style.marginLeft = -dims.gutterTotalWidth + "px";
    }
  }

  // POSITION OBJECT

  // A Pos instance represents a position within the text.
  var Pos = CodeMirror.Pos = function(line, ch) {
    if (!(this instanceof Pos)) return new Pos(line, ch);
    this.line = line; this.ch = ch;
  };

  // Compare two positions, return 0 if they are the same, a negative
  // number when a is less, and a positive number otherwise.
  var cmp = CodeMirror.cmpPos = function(a, b) { return a.line - b.line || a.ch - b.ch; };

  function copyPos(x) {return Pos(x.line, x.ch);}
  function maxPos(a, b) { return cmp(a, b) < 0 ? b : a; }
  function minPos(a, b) { return cmp(a, b) < 0 ? a : b; }

  // INPUT HANDLING

  function ensureFocus(cm) {
    if (!cm.state.focused) { cm.display.input.focus(); onFocus(cm); }
  }

  function isReadOnly(cm) {
    return cm.options.readOnly || cm.doc.cantEdit;
  }

  // This will be set to an array of strings when copying, so that,
  // when pasting, we know what kind of selections the copied text
  // was made out of.
  var lastCopied = null;

  function applyTextInput(cm, inserted, deleted, sel, origin) {
    var doc = cm.doc;
    cm.display.shift = false;
    if (!sel) sel = doc.sel;

    var paste = cm.state.pasteIncoming || origin == "paste";
    var textLines = doc.splitLines(inserted), multiPaste = null;
    // When pasing N lines into N selections, insert one line per selection
    if (paste && sel.ranges.length > 1) {
      if (lastCopied && lastCopied.join("\n") == inserted) {
        if (sel.ranges.length % lastCopied.length == 0) {
          multiPaste = [];
          for (var i = 0; i < lastCopied.length; i++)
            multiPaste.push(doc.splitLines(lastCopied[i]));
        }
      } else if (textLines.length == sel.ranges.length) {
        multiPaste = map(textLines, function(l) { return [l]; });
      }
    }

    // Normal behavior is to insert the new text into every selection
    for (var i = sel.ranges.length - 1; i >= 0; i--) {
      var range = sel.ranges[i];
      var from = range.from(), to = range.to();
      if (range.empty()) {
        if (deleted && deleted > 0) // Handle deletion
          from = Pos(from.line, from.ch - deleted);
        else if (cm.state.overwrite && !paste) // Handle overwrite
          to = Pos(to.line, Math.min(getLine(doc, to.line).text.length, to.ch + lst(textLines).length));
      }
      var updateInput = cm.curOp.updateInput;
      var changeEvent = {from: from, to: to, text: multiPaste ? multiPaste[i % multiPaste.length] : textLines,
                         origin: origin || (paste ? "paste" : cm.state.cutIncoming ? "cut" : "+input")};
      makeChange(cm.doc, changeEvent);
      signalLater(cm, "inputRead", cm, changeEvent);
    }
    if (inserted && !paste)
      triggerElectric(cm, inserted);

    ensureCursorVisible(cm);
    cm.curOp.updateInput = updateInput;
    cm.curOp.typing = true;
    cm.state.pasteIncoming = cm.state.cutIncoming = false;
  }

  function handlePaste(e, cm) {
    var pasted = e.clipboardData && e.clipboardData.getData("text/plain");
    if (pasted) {
      e.preventDefault();
      if (!isReadOnly(cm) && !cm.options.disableInput)
        runInOp(cm, function() { applyTextInput(cm, pasted, 0, null, "paste"); });
      return true;
    }
  }

  function triggerElectric(cm, inserted) {
    // When an 'electric' character is inserted, immediately trigger a reindent
    if (!cm.options.electricChars || !cm.options.smartIndent) return;
    var sel = cm.doc.sel;

    for (var i = sel.ranges.length - 1; i >= 0; i--) {
      var range = sel.ranges[i];
      if (range.head.ch > 100 || (i && sel.ranges[i - 1].head.line == range.head.line)) continue;
      var mode = cm.getModeAt(range.head);
      var indented = false;
      if (mode.electricChars) {
        for (var j = 0; j < mode.electricChars.length; j++)
          if (inserted.indexOf(mode.electricChars.charAt(j)) > -1) {
            indented = indentLine(cm, range.head.line, "smart");
            break;
          }
      } else if (mode.electricInput) {
        if (mode.electricInput.test(getLine(cm.doc, range.head.line).text.slice(0, range.head.ch)))
          indented = indentLine(cm, range.head.line, "smart");
      }
      if (indented) signalLater(cm, "electricInput", cm, range.head.line);
    }
  }

  function copyableRanges(cm) {
    var text = [], ranges = [];
    for (var i = 0; i < cm.doc.sel.ranges.length; i++) {
      var line = cm.doc.sel.ranges[i].head.line;
      var lineRange = {anchor: Pos(line, 0), head: Pos(line + 1, 0)};
      ranges.push(lineRange);
      text.push(cm.getRange(lineRange.anchor, lineRange.head));
    }
    return {text: text, ranges: ranges};
  }

  function disableBrowserMagic(field) {
    field.setAttribute("autocorrect", "off");
    field.setAttribute("autocapitalize", "off");
    field.setAttribute("spellcheck", "false");
  }

  // TEXTAREA INPUT STYLE

  function TextareaInput(cm) {
    this.cm = cm;
    // See input.poll and input.reset
    this.prevInput = "";

    // Flag that indicates whether we expect input to appear real soon
    // now (after some event like 'keypress' or 'input') and are
    // polling intensively.
    this.pollingFast = false;
    // Self-resetting timeout for the poller
    this.polling = new Delayed();
    // Tracks when input.reset has punted to just putting a short
    // string into the textarea instead of the full selection.
    this.inaccurateSelection = false;
    // Used to work around IE issue with selection being forgotten when focus moves away from textarea
    this.hasSelection = false;
    this.composing = null;
  };

  function hiddenTextarea() {
    var te = elt("textarea", null, null, "position: absolute; padding: 0; width: 1px; height: 1em; outline: none");
    var div = elt("div", [te], null, "overflow: hidden; position: relative; width: 3px; height: 0px;");
    // The textarea is kept positioned near the cursor to prevent the
    // fact that it'll be scrolled into view on input from scrolling
    // our fake cursor out of view. On webkit, when wrap=off, paste is
    // very slow. So make the area wide instead.
    if (webkit) te.style.width = "1000px";
    else te.setAttribute("wrap", "off");
    // If border: 0; -- iOS fails to open keyboard (issue #1287)
    if (ios) te.style.border = "1px solid black";
    disableBrowserMagic(te);
    return div;
  }

  TextareaInput.prototype = copyObj({
    init: function(display) {
      var input = this, cm = this.cm;

      // Wraps and hides input textarea
      var div = this.wrapper = hiddenTextarea();
      // The semihidden textarea that is focused when the editor is
      // focused, and receives input.
      var te = this.textarea = div.firstChild;
      display.wrapper.insertBefore(div, display.wrapper.firstChild);

      // Needed to hide big blue blinking cursor on Mobile Safari (doesn't seem to work in iOS 8 anymore)
      if (ios) te.style.width = "0px";

      on(te, "input", function() {
        if (ie && ie_version >= 9 && input.hasSelection) input.hasSelection = null;
        input.poll();
      });

      on(te, "paste", function(e) {
        if (handlePaste(e, cm)) return true;

        cm.state.pasteIncoming = true;
        input.fastPoll();
      });

      function prepareCopyCut(e) {
        if (cm.somethingSelected()) {
          lastCopied = cm.getSelections();
          if (input.inaccurateSelection) {
            input.prevInput = "";
            input.inaccurateSelection = false;
            te.value = lastCopied.join("\n");
            selectInput(te);
          }
        } else if (!cm.options.lineWiseCopyCut) {
          return;
        } else {
          var ranges = copyableRanges(cm);
          lastCopied = ranges.text;
          if (e.type == "cut") {
            cm.setSelections(ranges.ranges, null, sel_dontScroll);
          } else {
            input.prevInput = "";
            te.value = ranges.text.join("\n");
            selectInput(te);
          }
        }
        if (e.type == "cut") cm.state.cutIncoming = true;
      }
      on(te, "cut", prepareCopyCut);
      on(te, "copy", prepareCopyCut);

      on(display.scroller, "paste", function(e) {
        if (eventInWidget(display, e)) return;
        cm.state.pasteIncoming = true;
        input.focus();
      });

      // Prevent normal selection in the editor (we handle our own)
      on(display.lineSpace, "selectstart", function(e) {
        if (!eventInWidget(display, e)) e_preventDefault(e);
      });

      on(te, "compositionstart", function() {
        var start = cm.getCursor("from");
        if (input.composing) input.composing.range.clear()
        input.composing = {
          start: start,
          range: cm.markText(start, cm.getCursor("to"), {className: "CodeMirror-composing"})
        };
      });
      on(te, "compositionend", function() {
        if (input.composing) {
          input.poll();
          input.composing.range.clear();
          input.composing = null;
        }
      });
    },

    prepareSelection: function() {
      // Redraw the selection and/or cursor
      var cm = this.cm, display = cm.display, doc = cm.doc;
      var result = prepareSelection(cm);

      // Move the hidden textarea near the cursor to prevent scrolling artifacts
      if (cm.options.moveInputWithCursor) {
        var headPos = cursorCoords(cm, doc.sel.primary().head, "div");
        var wrapOff = display.wrapper.getBoundingClientRect(), lineOff = display.lineDiv.getBoundingClientRect();
        result.teTop = Math.max(0, Math.min(display.wrapper.clientHeight - 10,
                                            headPos.top + lineOff.top - wrapOff.top));
        result.teLeft = Math.max(0, Math.min(display.wrapper.clientWidth - 10,
                                             headPos.left + lineOff.left - wrapOff.left));
      }

      return result;
    },

    showSelection: function(drawn) {
      var cm = this.cm, display = cm.display;
      removeChildrenAndAdd(display.cursorDiv, drawn.cursors);
      removeChildrenAndAdd(display.selectionDiv, drawn.selection);
      if (drawn.teTop != null) {
        this.wrapper.style.top = drawn.teTop + "px";
        this.wrapper.style.left = drawn.teLeft + "px";
      }
    },

    // Reset the input to correspond to the selection (or to be empty,
    // when not typing and nothing is selected)
    reset: function(typing) {
      if (this.contextMenuPending) return;
      var minimal, selected, cm = this.cm, doc = cm.doc;
      if (cm.somethingSelected()) {
        this.prevInput = "";
        var range = doc.sel.primary();
        minimal = hasCopyEvent &&
          (range.to().line - range.from().line > 100 || (selected = cm.getSelection()).length > 1000);
        var content = minimal ? "-" : selected || cm.getSelection();
        this.textarea.value = content;
        if (cm.state.focused) selectInput(this.textarea);
        if (ie && ie_version >= 9) this.hasSelection = content;
      } else if (!typing) {
        this.prevInput = this.textarea.value = "";
        if (ie && ie_version >= 9) this.hasSelection = null;
      }
      this.inaccurateSelection = minimal;
    },

    getField: function() { return this.textarea; },

    supportsTouch: function() { return false; },

    focus: function() {
      if (this.cm.options.readOnly != "nocursor" && (!mobile || activeElt() != this.textarea)) {
        try { this.textarea.focus(); }
        catch (e) {} // IE8 will throw if the textarea is display: none or not in DOM
      }
    },

    blur: function() { this.textarea.blur(); },

    resetPosition: function() {
      this.wrapper.style.top = this.wrapper.style.left = 0;
    },

    receivedFocus: function() { this.slowPoll(); },

    // Poll for input changes, using the normal rate of polling. This
    // runs as long as the editor is focused.
    slowPoll: function() {
      var input = this;
      if (input.pollingFast) return;
      input.polling.set(this.cm.options.pollInterval, function() {
        input.poll();
        if (input.cm.state.focused) input.slowPoll();
      });
    },

    // When an event has just come in that is likely to add or change
    // something in the input textarea, we poll faster, to ensure that
    // the change appears on the screen quickly.
    fastPoll: function() {
      var missed = false, input = this;
      input.pollingFast = true;
      function p() {
        var changed = input.poll();
        if (!changed && !missed) {missed = true; input.polling.set(60, p);}
        else {input.pollingFast = false; input.slowPoll();}
      }
      input.polling.set(20, p);
    },

    // Read input from the textarea, and update the document to match.
    // When something is selected, it is present in the textarea, and
    // selected (unless it is huge, in which case a placeholder is
    // used). When nothing is selected, the cursor sits after previously
    // seen text (can be empty), which is stored in prevInput (we must
    // not reset the textarea when typing, because that breaks IME).
    poll: function() {
      var cm = this.cm, input = this.textarea, prevInput = this.prevInput;
      // Since this is called a *lot*, try to bail out as cheaply as
      // possible when it is clear that nothing happened. hasSelection
      // will be the case when there is a lot of text in the textarea,
      // in which case reading its value would be expensive.
      if (this.contextMenuPending || !cm.state.focused ||
          (hasSelection(input) && !prevInput && !this.composing) ||
          isReadOnly(cm) || cm.options.disableInput || cm.state.keySeq)
        return false;

      var text = input.value;
      // If nothing changed, bail.
      if (text == prevInput && !cm.somethingSelected()) return false;
      // Work around nonsensical selection resetting in IE9/10, and
      // inexplicable appearance of private area unicode characters on
      // some key combos in Mac (#2689).
      if (ie && ie_version >= 9 && this.hasSelection === text ||
          mac && /[\uf700-\uf7ff]/.test(text)) {
        cm.display.input.reset();
        return false;
      }

      if (cm.doc.sel == cm.display.selForContextMenu) {
        var first = text.charCodeAt(0);
        if (first == 0x200b && !prevInput) prevInput = "\u200b";
        if (first == 0x21da) { this.reset(); return this.cm.execCommand("undo"); }
      }
      // Find the part of the input that is actually new
      var same = 0, l = Math.min(prevInput.length, text.length);
      while (same < l && prevInput.charCodeAt(same) == text.charCodeAt(same)) ++same;

      var self = this;
      runInOp(cm, function() {
        applyTextInput(cm, text.slice(same), prevInput.length - same,
                       null, self.composing ? "*compose" : null);

        // Don't leave long text in the textarea, since it makes further polling slow
        if (text.length > 1000 || text.indexOf("\n") > -1) input.value = self.prevInput = "";
        else self.prevInput = text;

        if (self.composing) {
          self.composing.range.clear();
          self.composing.range = cm.markText(self.composing.start, cm.getCursor("to"),
                                             {className: "CodeMirror-composing"});
        }
      });
      return true;
    },

    ensurePolled: function() {
      if (this.pollingFast && this.poll()) this.pollingFast = false;
    },

    onKeyPress: function() {
      if (ie && ie_version >= 9) this.hasSelection = null;
      this.fastPoll();
    },

    onContextMenu: function(e) {
      var input = this, cm = input.cm, display = cm.display, te = input.textarea;
      var pos = posFromMouse(cm, e), scrollPos = display.scroller.scrollTop;
      if (!pos || presto) return; // Opera is difficult.

      // Reset the current text selection only if the click is done outside of the selection
      // and 'resetSelectionOnContextMenu' option is true.
      var reset = cm.options.resetSelectionOnContextMenu;
      if (reset && cm.doc.sel.contains(pos) == -1)
        operation(cm, setSelection)(cm.doc, simpleSelection(pos), sel_dontScroll);

      var oldCSS = te.style.cssText;
      input.wrapper.style.position = "absolute";
      te.style.cssText = "position: fixed; width: 30px; height: 30px; top: " + (e.clientY - 5) +
        "px; left: " + (e.clientX - 5) + "px; z-index: 1000; background: " +
        (ie ? "rgba(255, 255, 255, .05)" : "transparent") +
        "; outline: none; border-width: 0; outline: none; overflow: hidden; opacity: .05; filter: alpha(opacity=5);";
      if (webkit) var oldScrollY = window.scrollY; // Work around Chrome issue (#2712)
      display.input.focus();
      if (webkit) window.scrollTo(null, oldScrollY);
      display.input.reset();
      // Adds "Select all" to context menu in FF
      if (!cm.somethingSelected()) te.value = input.prevInput = " ";
      input.contextMenuPending = true;
      display.selForContextMenu = cm.doc.sel;
      clearTimeout(display.detectingSelectAll);

      // Select-all will be greyed out if there's nothing to select, so
      // this adds a zero-width space so that we can later check whether
      // it got selected.
      function prepareSelectAllHack() {
        if (te.selectionStart != null) {
          var selected = cm.somethingSelected();
          var extval = "\u200b" + (selected ? te.value : "");
          te.value = "\u21da"; // Used to catch context-menu undo
          te.value = extval;
          input.prevInput = selected ? "" : "\u200b";
          te.selectionStart = 1; te.selectionEnd = extval.length;
          // Re-set this, in case some other handler touched the
          // selection in the meantime.
          display.selForContextMenu = cm.doc.sel;
        }
      }
      function rehide() {
        input.contextMenuPending = false;
        input.wrapper.style.position = "relative";
        te.style.cssText = oldCSS;
        if (ie && ie_version < 9) display.scrollbars.setScrollTop(display.scroller.scrollTop = scrollPos);

        // Try to detect the user choosing select-all
        if (te.selectionStart != null) {
          if (!ie || (ie && ie_version < 9)) prepareSelectAllHack();
          var i = 0, poll = function() {
            if (display.selForContextMenu == cm.doc.sel && te.selectionStart == 0 &&
                te.selectionEnd > 0 && input.prevInput == "\u200b")
              operation(cm, commands.selectAll)(cm);
            else if (i++ < 10) display.detectingSelectAll = setTimeout(poll, 500);
            else display.input.reset();
          };
          display.detectingSelectAll = setTimeout(poll, 200);
        }
      }

      if (ie && ie_version >= 9) prepareSelectAllHack();
      if (captureRightClick) {
        e_stop(e);
        var mouseup = function() {
          off(window, "mouseup", mouseup);
          setTimeout(rehide, 20);
        };
        on(window, "mouseup", mouseup);
      } else {
        setTimeout(rehide, 50);
      }
    },

    readOnlyChanged: function(val) {
      if (!val) this.reset();
    },

    setUneditable: nothing,

    needsContentAttribute: false
  }, TextareaInput.prototype);

  // CONTENTEDITABLE INPUT STYLE

  function ContentEditableInput(cm) {
    this.cm = cm;
    this.lastAnchorNode = this.lastAnchorOffset = this.lastFocusNode = this.lastFocusOffset = null;
    this.polling = new Delayed();
    this.gracePeriod = false;
  }

  ContentEditableInput.prototype = copyObj({
    init: function(display) {
      var input = this, cm = input.cm;
      var div = input.div = display.lineDiv;
      disableBrowserMagic(div);

      on(div, "paste", function(e) { handlePaste(e, cm); })

      on(div, "compositionstart", function(e) {
        var data = e.data;
        input.composing = {sel: cm.doc.sel, data: data, startData: data};
        if (!data) return;
        var prim = cm.doc.sel.primary();
        var line = cm.getLine(prim.head.line);
        var found = line.indexOf(data, Math.max(0, prim.head.ch - data.length));
        if (found > -1 && found <= prim.head.ch)
          input.composing.sel = simpleSelection(Pos(prim.head.line, found),
                                                Pos(prim.head.line, found + data.length));
      });
      on(div, "compositionupdate", function(e) {
        input.composing.data = e.data;
      });
      on(div, "compositionend", function(e) {
        var ours = input.composing;
        if (!ours) return;
        if (e.data != ours.startData && !/\u200b/.test(e.data))
          ours.data = e.data;
        // Need a small delay to prevent other code (input event,
        // selection polling) from doing damage when fired right after
        // compositionend.
        setTimeout(function() {
          if (!ours.handled)
            input.applyComposition(ours);
          if (input.composing == ours)
            input.composing = null;
        }, 50);
      });

      on(div, "touchstart", function() {
        input.forceCompositionEnd();
      });

      on(div, "input", function() {
        if (input.composing) return;
        if (isReadOnly(cm) || !input.pollContent())
          runInOp(input.cm, function() {regChange(cm);});
      });

      function onCopyCut(e) {
        if (cm.somethingSelected()) {
          lastCopied = cm.getSelections();
          if (e.type == "cut") cm.replaceSelection("", null, "cut");
        } else if (!cm.options.lineWiseCopyCut) {
          return;
        } else {
          var ranges = copyableRanges(cm);
          lastCopied = ranges.text;
          if (e.type == "cut") {
            cm.operation(function() {
              cm.setSelections(ranges.ranges, 0, sel_dontScroll);
              cm.replaceSelection("", null, "cut");
            });
          }
        }
        // iOS exposes the clipboard API, but seems to discard content inserted into it
        if (e.clipboardData && !ios) {
          e.preventDefault();
          e.clipboardData.clearData();
          e.clipboardData.setData("text/plain", lastCopied.join("\n"));
        } else {
          // Old-fashioned briefly-focus-a-textarea hack
          var kludge = hiddenTextarea(), te = kludge.firstChild;
          cm.display.lineSpace.insertBefore(kludge, cm.display.lineSpace.firstChild);
          te.value = lastCopied.join("\n");
          var hadFocus = document.activeElement;
          selectInput(te);
          setTimeout(function() {
            cm.display.lineSpace.removeChild(kludge);
            hadFocus.focus();
          }, 50);
        }
      }
      on(div, "copy", onCopyCut);
      on(div, "cut", onCopyCut);
    },

    prepareSelection: function() {
      var result = prepareSelection(this.cm, false);
      result.focus = this.cm.state.focused;
      return result;
    },

    showSelection: function(info) {
      if (!info || !this.cm.display.view.length) return;
      if (info.focus) this.showPrimarySelection();
      this.showMultipleSelections(info);
    },

    showPrimarySelection: function() {
      var sel = window.getSelection(), prim = this.cm.doc.sel.primary();
      var curAnchor = domToPos(this.cm, sel.anchorNode, sel.anchorOffset);
      var curFocus = domToPos(this.cm, sel.focusNode, sel.focusOffset);
      if (curAnchor && !curAnchor.bad && curFocus && !curFocus.bad &&
          cmp(minPos(curAnchor, curFocus), prim.from()) == 0 &&
          cmp(maxPos(curAnchor, curFocus), prim.to()) == 0)
        return;

      var start = posToDOM(this.cm, prim.from());
      var end = posToDOM(this.cm, prim.to());
      if (!start && !end) return;

      var view = this.cm.display.view;
      var old = sel.rangeCount && sel.getRangeAt(0);
      if (!start) {
        start = {node: view[0].measure.map[2], offset: 0};
      } else if (!end) { // FIXME dangerously hacky
        var measure = view[view.length - 1].measure;
        var map = measure.maps ? measure.maps[measure.maps.length - 1] : measure.map;
        end = {node: map[map.length - 1], offset: map[map.length - 2] - map[map.length - 3]};
      }

      try { var rng = range(start.node, start.offset, end.offset, end.node); }
      catch(e) {} // Our model of the DOM might be outdated, in which case the range we try to set can be impossible
      if (rng) {
        sel.removeAllRanges();
        sel.addRange(rng);
        if (old && sel.anchorNode == null) sel.addRange(old);
        else if (gecko) this.startGracePeriod();
      }
      this.rememberSelection();
    },

    startGracePeriod: function() {
      var input = this;
      clearTimeout(this.gracePeriod);
      this.gracePeriod = setTimeout(function() {
        input.gracePeriod = false;
        if (input.selectionChanged())
          input.cm.operation(function() { input.cm.curOp.selectionChanged = true; });
      }, 20);
    },

    showMultipleSelections: function(info) {
      removeChildrenAndAdd(this.cm.display.cursorDiv, info.cursors);
      removeChildrenAndAdd(this.cm.display.selectionDiv, info.selection);
    },

    rememberSelection: function() {
      var sel = window.getSelection();
      this.lastAnchorNode = sel.anchorNode; this.lastAnchorOffset = sel.anchorOffset;
      this.lastFocusNode = sel.focusNode; this.lastFocusOffset = sel.focusOffset;
    },

    selectionInEditor: function() {
      var sel = window.getSelection();
      if (!sel.rangeCount) return false;
      var node = sel.getRangeAt(0).commonAncestorContainer;
      return contains(this.div, node);
    },

    focus: function() {
      if (this.cm.options.readOnly != "nocursor") this.div.focus();
    },
    blur: function() { this.div.blur(); },
    getField: function() { return this.div; },

    supportsTouch: function() { return true; },

    receivedFocus: function() {
      var input = this;
      if (this.selectionInEditor())
        this.pollSelection();
      else
        runInOp(this.cm, function() { input.cm.curOp.selectionChanged = true; });

      function poll() {
        if (input.cm.state.focused) {
          input.pollSelection();
          input.polling.set(input.cm.options.pollInterval, poll);
        }
      }
      this.polling.set(this.cm.options.pollInterval, poll);
    },

    selectionChanged: function() {
      var sel = window.getSelection();
      return sel.anchorNode != this.lastAnchorNode || sel.anchorOffset != this.lastAnchorOffset ||
        sel.focusNode != this.lastFocusNode || sel.focusOffset != this.lastFocusOffset;
    },

    pollSelection: function() {
      if (!this.composing && !this.gracePeriod && this.selectionChanged()) {
        var sel = window.getSelection(), cm = this.cm;
        this.rememberSelection();
        var anchor = domToPos(cm, sel.anchorNode, sel.anchorOffset);
        var head = domToPos(cm, sel.focusNode, sel.focusOffset);
        if (anchor && head) runInOp(cm, function() {
          setSelection(cm.doc, simpleSelection(anchor, head), sel_dontScroll);
          if (anchor.bad || head.bad) cm.curOp.selectionChanged = true;
        });
      }
    },

    pollContent: function() {
      var cm = this.cm, display = cm.display, sel = cm.doc.sel.primary();
      var from = sel.from(), to = sel.to();
      if (from.line < display.viewFrom || to.line > display.viewTo - 1) return false;

      var fromIndex;
      if (from.line == display.viewFrom || (fromIndex = findViewIndex(cm, from.line)) == 0) {
        var fromLine = lineNo(display.view[0].line);
        var fromNode = display.view[0].node;
      } else {
        var fromLine = lineNo(display.view[fromIndex].line);
        var fromNode = display.view[fromIndex - 1].node.nextSibling;
      }
      var toIndex = findViewIndex(cm, to.line);
      if (toIndex == display.view.length - 1) {
        var toLine = display.viewTo - 1;
        var toNode = display.lineDiv.lastChild;
      } else {
        var toLine = lineNo(display.view[toIndex + 1].line) - 1;
        var toNode = display.view[toIndex + 1].node.previousSibling;
      }

      var newText = cm.doc.splitLines(domTextBetween(cm, fromNode, toNode, fromLine, toLine));
      var oldText = getBetween(cm.doc, Pos(fromLine, 0), Pos(toLine, getLine(cm.doc, toLine).text.length));
      while (newText.length > 1 && oldText.length > 1) {
        if (lst(newText) == lst(oldText)) { newText.pop(); oldText.pop(); toLine--; }
        else if (newText[0] == oldText[0]) { newText.shift(); oldText.shift(); fromLine++; }
        else break;
      }

      var cutFront = 0, cutEnd = 0;
      var newTop = newText[0], oldTop = oldText[0], maxCutFront = Math.min(newTop.length, oldTop.length);
      while (cutFront < maxCutFront && newTop.charCodeAt(cutFront) == oldTop.charCodeAt(cutFront))
        ++cutFront;
      var newBot = lst(newText), oldBot = lst(oldText);
      var maxCutEnd = Math.min(newBot.length - (newText.length == 1 ? cutFront : 0),
                               oldBot.length - (oldText.length == 1 ? cutFront : 0));
      while (cutEnd < maxCutEnd &&
             newBot.charCodeAt(newBot.length - cutEnd - 1) == oldBot.charCodeAt(oldBot.length - cutEnd - 1))
        ++cutEnd;

      newText[newText.length - 1] = newBot.slice(0, newBot.length - cutEnd);
      newText[0] = newText[0].slice(cutFront);

      var chFrom = Pos(fromLine, cutFront);
      var chTo = Pos(toLine, oldText.length ? lst(oldText).length - cutEnd : 0);
      if (newText.length > 1 || newText[0] || cmp(chFrom, chTo)) {
        replaceRange(cm.doc, newText, chFrom, chTo, "+input");
        return true;
      }
    },

    ensurePolled: function() {
      this.forceCompositionEnd();
    },
    reset: function() {
      this.forceCompositionEnd();
    },
    forceCompositionEnd: function() {
      if (!this.composing || this.composing.handled) return;
      this.applyComposition(this.composing);
      this.composing.handled = true;
      this.div.blur();
      this.div.focus();
    },
    applyComposition: function(composing) {
      if (isReadOnly(this.cm))
        operation(this.cm, regChange)(this.cm)
      else if (composing.data && composing.data != composing.startData)
        operation(this.cm, applyTextInput)(this.cm, composing.data, 0, composing.sel);
    },

    setUneditable: function(node) {
      node.contentEditable = "false"
    },

    onKeyPress: function(e) {
      e.preventDefault();
      if (!isReadOnly(this.cm))
        operation(this.cm, applyTextInput)(this.cm, String.fromCharCode(e.charCode == null ? e.keyCode : e.charCode), 0);
    },

    readOnlyChanged: function(val) {
      this.div.contentEditable = String(val != "nocursor")
    },

    onContextMenu: nothing,
    resetPosition: nothing,

    needsContentAttribute: true
  }, ContentEditableInput.prototype);

  function posToDOM(cm, pos) {
    var view = findViewForLine(cm, pos.line);
    if (!view || view.hidden) return null;
    var line = getLine(cm.doc, pos.line);
    var info = mapFromLineView(view, line, pos.line);

    var order = getOrder(line), side = "left";
    if (order) {
      var partPos = getBidiPartAt(order, pos.ch);
      side = partPos % 2 ? "right" : "left";
    }
    var result = nodeAndOffsetInLineMap(info.map, pos.ch, side);
    result.offset = result.collapse == "right" ? result.end : result.start;
    return result;
  }

  function badPos(pos, bad) { if (bad) pos.bad = true; return pos; }

  function domToPos(cm, node, offset) {
    var lineNode;
    if (node == cm.display.lineDiv) {
      lineNode = cm.display.lineDiv.childNodes[offset];
      if (!lineNode) return badPos(cm.clipPos(Pos(cm.display.viewTo - 1)), true);
      node = null; offset = 0;
    } else {
      for (lineNode = node;; lineNode = lineNode.parentNode) {
        if (!lineNode || lineNode == cm.display.lineDiv) return null;
        if (lineNode.parentNode && lineNode.parentNode == cm.display.lineDiv) break;
      }
    }
    for (var i = 0; i < cm.display.view.length; i++) {
      var lineView = cm.display.view[i];
      if (lineView.node == lineNode)
        return locateNodeInLineView(lineView, node, offset);
    }
  }

  function locateNodeInLineView(lineView, node, offset) {
    var wrapper = lineView.text.firstChild, bad = false;
    if (!node || !contains(wrapper, node)) return badPos(Pos(lineNo(lineView.line), 0), true);
    if (node == wrapper) {
      bad = true;
      node = wrapper.childNodes[offset];
      offset = 0;
      if (!node) {
        var line = lineView.rest ? lst(lineView.rest) : lineView.line;
        return badPos(Pos(lineNo(line), line.text.length), bad);
      }
    }

    var textNode = node.nodeType == 3 ? node : null, topNode = node;
    if (!textNode && node.childNodes.length == 1 && node.firstChild.nodeType == 3) {
      textNode = node.firstChild;
      if (offset) offset = textNode.nodeValue.length;
    }
    while (topNode.parentNode != wrapper) topNode = topNode.parentNode;
    var measure = lineView.measure, maps = measure.maps;

    function find(textNode, topNode, offset) {
      for (var i = -1; i < (maps ? maps.length : 0); i++) {
        var map = i < 0 ? measure.map : maps[i];
        for (var j = 0; j < map.length; j += 3) {
          var curNode = map[j + 2];
          if (curNode == textNode || curNode == topNode) {
            var line = lineNo(i < 0 ? lineView.line : lineView.rest[i]);
            var ch = map[j] + offset;
            if (offset < 0 || curNode != textNode) ch = map[j + (offset ? 1 : 0)];
            return Pos(line, ch);
          }
        }
      }
    }
    var found = find(textNode, topNode, offset);
    if (found) return badPos(found, bad);

    // FIXME this is all really shaky. might handle the few cases it needs to handle, but likely to cause problems
    for (var after = topNode.nextSibling, dist = textNode ? textNode.nodeValue.length - offset : 0; after; after = after.nextSibling) {
      found = find(after, after.firstChild, 0);
      if (found)
        return badPos(Pos(found.line, found.ch - dist), bad);
      else
        dist += after.textContent.length;
    }
    for (var before = topNode.previousSibling, dist = offset; before; before = before.previousSibling) {
      found = find(before, before.firstChild, -1);
      if (found)
        return badPos(Pos(found.line, found.ch + dist), bad);
      else
        dist += after.textContent.length;
    }
  }

  function domTextBetween(cm, from, to, fromLine, toLine) {
    var text = "", closing = false, lineSep = cm.doc.lineSeparator();
    function recognizeMarker(id) { return function(marker) { return marker.id == id; }; }
    function walk(node) {
      if (node.nodeType == 1) {
        var cmText = node.getAttribute("cm-text");
        if (cmText != null) {
          if (cmText == "") cmText = node.textContent.replace(/\u200b/g, "");
          text += cmText;
          return;
        }
        var markerID = node.getAttribute("cm-marker"), range;
        if (markerID) {
          var found = cm.findMarks(Pos(fromLine, 0), Pos(toLine + 1, 0), recognizeMarker(+markerID));
          if (found.length && (range = found[0].find()))
            text += getBetween(cm.doc, range.from, range.to).join(lineSep);
          return;
        }
        if (node.getAttribute("contenteditable") == "false") return;
        for (var i = 0; i < node.childNodes.length; i++)
          walk(node.childNodes[i]);
        if (/^(pre|div|p)$/i.test(node.nodeName))
          closing = true;
      } else if (node.nodeType == 3) {
        var val = node.nodeValue;
        if (!val) return;
        if (closing) {
          text += lineSep;
          closing = false;
        }
        text += val;
      }
    }
    for (;;) {
      walk(from);
      if (from == to) break;
      from = from.nextSibling;
    }
    return text;
  }

  CodeMirror.inputStyles = {"textarea": TextareaInput, "contenteditable": ContentEditableInput};

  // SELECTION / CURSOR

  // Selection objects are immutable. A new one is created every time
  // the selection changes. A selection is one or more non-overlapping
  // (and non-touching) ranges, sorted, and an integer that indicates
  // which one is the primary selection (the one that's scrolled into
  // view, that getCursor returns, etc).
  function Selection(ranges, primIndex) {
    this.ranges = ranges;
    this.primIndex = primIndex;
  }

  Selection.prototype = {
    primary: function() { return this.ranges[this.primIndex]; },
    equals: function(other) {
      if (other == this) return true;
      if (other.primIndex != this.primIndex || other.ranges.length != this.ranges.length) return false;
      for (var i = 0; i < this.ranges.length; i++) {
        var here = this.ranges[i], there = other.ranges[i];
        if (cmp(here.anchor, there.anchor) != 0 || cmp(here.head, there.head) != 0) return false;
      }
      return true;
    },
    deepCopy: function() {
      for (var out = [], i = 0; i < this.ranges.length; i++)
        out[i] = new Range(copyPos(this.ranges[i].anchor), copyPos(this.ranges[i].head));
      return new Selection(out, this.primIndex);
    },
    somethingSelected: function() {
      for (var i = 0; i < this.ranges.length; i++)
        if (!this.ranges[i].empty()) return true;
      return false;
    },
    contains: function(pos, end) {
      if (!end) end = pos;
      for (var i = 0; i < this.ranges.length; i++) {
        var range = this.ranges[i];
        if (cmp(end, range.from()) >= 0 && cmp(pos, range.to()) <= 0)
          return i;
      }
      return -1;
    }
  };

  function Range(anchor, head) {
    this.anchor = anchor; this.head = head;
  }

  Range.prototype = {
    from: function() { return minPos(this.anchor, this.head); },
    to: function() { return maxPos(this.anchor, this.head); },
    empty: function() {
      return this.head.line == this.anchor.line && this.head.ch == this.anchor.ch;
    }
  };

  // Take an unsorted, potentially overlapping set of ranges, and
  // build a selection out of it. 'Consumes' ranges array (modifying
  // it).
  function normalizeSelection(ranges, primIndex) {
    var prim = ranges[primIndex];
    ranges.sort(function(a, b) { return cmp(a.from(), b.from()); });
    primIndex = indexOf(ranges, prim);
    for (var i = 1; i < ranges.length; i++) {
      var cur = ranges[i], prev = ranges[i - 1];
      if (cmp(prev.to(), cur.from()) >= 0) {
        var from = minPos(prev.from(), cur.from()), to = maxPos(prev.to(), cur.to());
        var inv = prev.empty() ? cur.from() == cur.head : prev.from() == prev.head;
        if (i <= primIndex) --primIndex;
        ranges.splice(--i, 2, new Range(inv ? to : from, inv ? from : to));
      }
    }
    return new Selection(ranges, primIndex);
  }

  function simpleSelection(anchor, head) {
    return new Selection([new Range(anchor, head || anchor)], 0);
  }

  // Most of the external API clips given positions to make sure they
  // actually exist within the document.
  function clipLine(doc, n) {return Math.max(doc.first, Math.min(n, doc.first + doc.size - 1));}
  function clipPos(doc, pos) {
    if (pos.line < doc.first) return Pos(doc.first, 0);
    var last = doc.first + doc.size - 1;
    if (pos.line > last) return Pos(last, getLine(doc, last).text.length);
    return clipToLen(pos, getLine(doc, pos.line).text.length);
  }
  function clipToLen(pos, linelen) {
    var ch = pos.ch;
    if (ch == null || ch > linelen) return Pos(pos.line, linelen);
    else if (ch < 0) return Pos(pos.line, 0);
    else return pos;
  }
  function isLine(doc, l) {return l >= doc.first && l < doc.first + doc.size;}
  function clipPosArray(doc, array) {
    for (var out = [], i = 0; i < array.length; i++) out[i] = clipPos(doc, array[i]);
    return out;
  }

  // SELECTION UPDATES

  // The 'scroll' parameter given to many of these indicated whether
  // the new cursor position should be scrolled into view after
  // modifying the selection.

  // If shift is held or the extend flag is set, extends a range to
  // include a given position (and optionally a second position).
  // Otherwise, simply returns the range between the given positions.
  // Used for cursor motion and such.
  function extendRange(doc, range, head, other) {
    if (doc.cm && doc.cm.display.shift || doc.extend) {
      var anchor = range.anchor;
      if (other) {
        var posBefore = cmp(head, anchor) < 0;
        if (posBefore != (cmp(other, anchor) < 0)) {
          anchor = head;
          head = other;
        } else if (posBefore != (cmp(head, other) < 0)) {
          head = other;
        }
      }
      return new Range(anchor, head);
    } else {
      return new Range(other || head, head);
    }
  }

  // Extend the primary selection range, discard the rest.
  function extendSelection(doc, head, other, options) {
    setSelection(doc, new Selection([extendRange(doc, doc.sel.primary(), head, other)], 0), options);
  }

  // Extend all selections (pos is an array of selections with length
  // equal the number of selections)
  function extendSelections(doc, heads, options) {
    for (var out = [], i = 0; i < doc.sel.ranges.length; i++)
      out[i] = extendRange(doc, doc.sel.ranges[i], heads[i], null);
    var newSel = normalizeSelection(out, doc.sel.primIndex);
    setSelection(doc, newSel, options);
  }

  // Updates a single range in the selection.
  function replaceOneSelection(doc, i, range, options) {
    var ranges = doc.sel.ranges.slice(0);
    ranges[i] = range;
    setSelection(doc, normalizeSelection(ranges, doc.sel.primIndex), options);
  }

  // Reset the selection to a single range.
  function setSimpleSelection(doc, anchor, head, options) {
    setSelection(doc, simpleSelection(anchor, head), options);
  }

  // Give beforeSelectionChange handlers a change to influence a
  // selection update.
  function filterSelectionChange(doc, sel) {
    var obj = {
      ranges: sel.ranges,
      update: function(ranges) {
        this.ranges = [];
        for (var i = 0; i < ranges.length; i++)
          this.ranges[i] = new Range(clipPos(doc, ranges[i].anchor),
                                     clipPos(doc, ranges[i].head));
      }
    };
    signal(doc, "beforeSelectionChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeSelectionChange", doc.cm, obj);
    if (obj.ranges != sel.ranges) return normalizeSelection(obj.ranges, obj.ranges.length - 1);
    else return sel;
  }

  function setSelectionReplaceHistory(doc, sel, options) {
    var done = doc.history.done, last = lst(done);
    if (last && last.ranges) {
      done[done.length - 1] = sel;
      setSelectionNoUndo(doc, sel, options);
    } else {
      setSelection(doc, sel, options);
    }
  }

  // Set a new selection.
  function setSelection(doc, sel, options) {
    setSelectionNoUndo(doc, sel, options);
    addSelectionToHistory(doc, doc.sel, doc.cm ? doc.cm.curOp.id : NaN, options);
  }

  function setSelectionNoUndo(doc, sel, options) {
    if (hasHandler(doc, "beforeSelectionChange") || doc.cm && hasHandler(doc.cm, "beforeSelectionChange"))
      sel = filterSelectionChange(doc, sel);

    var bias = options && options.bias ||
      (cmp(sel.primary().head, doc.sel.primary().head) < 0 ? -1 : 1);
    setSelectionInner(doc, skipAtomicInSelection(doc, sel, bias, true));

    if (!(options && options.scroll === false) && doc.cm)
      ensureCursorVisible(doc.cm);
  }

  function setSelectionInner(doc, sel) {
    if (sel.equals(doc.sel)) return;

    doc.sel = sel;

    if (doc.cm) {
      doc.cm.curOp.updateInput = doc.cm.curOp.selectionChanged = true;
      signalCursorActivity(doc.cm);
    }
    signalLater(doc, "cursorActivity", doc);
  }

  // Verify that the selection does not partially select any atomic
  // marked ranges.
  function reCheckSelection(doc) {
    setSelectionInner(doc, skipAtomicInSelection(doc, doc.sel, null, false), sel_dontScroll);
  }

  // Return a selection that does not partially select any atomic
  // ranges.
  function skipAtomicInSelection(doc, sel, bias, mayClear) {
    var out;
    for (var i = 0; i < sel.ranges.length; i++) {
      var range = sel.ranges[i];
      var newAnchor = skipAtomic(doc, range.anchor, bias, mayClear);
      var newHead = skipAtomic(doc, range.head, bias, mayClear);
      if (out || newAnchor != range.anchor || newHead != range.head) {
        if (!out) out = sel.ranges.slice(0, i);
        out[i] = new Range(newAnchor, newHead);
      }
    }
    return out ? normalizeSelection(out, sel.primIndex) : sel;
  }

  // Ensure a given position is not inside an atomic range.
  function skipAtomic(doc, pos, bias, mayClear) {
    var flipped = false, curPos = pos;
    var dir = bias || 1;
    doc.cantEdit = false;
    search: for (;;) {
      var line = getLine(doc, curPos.line);
      if (line.markedSpans) {
        for (var i = 0; i < line.markedSpans.length; ++i) {
          var sp = line.markedSpans[i], m = sp.marker;
          if ((sp.from == null || (m.inclusiveLeft ? sp.from <= curPos.ch : sp.from < curPos.ch)) &&
              (sp.to == null || (m.inclusiveRight ? sp.to >= curPos.ch : sp.to > curPos.ch))) {
            if (mayClear) {
              signal(m, "beforeCursorEnter");
              if (m.explicitlyCleared) {
                if (!line.markedSpans) break;
                else {--i; continue;}
              }
            }
            if (!m.atomic) continue;
            var newPos = m.find(dir < 0 ? -1 : 1);
            if (cmp(newPos, curPos) == 0) {
              newPos.ch += dir;
              if (newPos.ch < 0) {
                if (newPos.line > doc.first) newPos = clipPos(doc, Pos(newPos.line - 1));
                else newPos = null;
              } else if (newPos.ch > line.text.length) {
                if (newPos.line < doc.first + doc.size - 1) newPos = Pos(newPos.line + 1, 0);
                else newPos = null;
              }
              if (!newPos) {
                if (flipped) {
                  // Driven in a corner -- no valid cursor position found at all
                  // -- try again *with* clearing, if we didn't already
                  if (!mayClear) return skipAtomic(doc, pos, bias, true);
                  // Otherwise, turn off editing until further notice, and return the start of the doc
                  doc.cantEdit = true;
                  return Pos(doc.first, 0);
                }
                flipped = true; newPos = pos; dir = -dir;
              }
            }
            curPos = newPos;
            continue search;
          }
        }
      }
      return curPos;
    }
  }

  // SELECTION DRAWING

  function updateSelection(cm) {
    cm.display.input.showSelection(cm.display.input.prepareSelection());
  }

  function prepareSelection(cm, primary) {
    var doc = cm.doc, result = {};
    var curFragment = result.cursors = document.createDocumentFragment();
    var selFragment = result.selection = document.createDocumentFragment();

    for (var i = 0; i < doc.sel.ranges.length; i++) {
      if (primary === false && i == doc.sel.primIndex) continue;
      var range = doc.sel.ranges[i];
      var collapsed = range.empty();
      if (collapsed || cm.options.showCursorWhenSelecting)
        drawSelectionCursor(cm, range.head, curFragment);
      if (!collapsed)
        drawSelectionRange(cm, range, selFragment);
    }
    return result;
  }

  // Draws a cursor for the given range
  function drawSelectionCursor(cm, head, output) {
    var pos = cursorCoords(cm, head, "div", null, null, !cm.options.singleCursorHeightPerLine);

    var cursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor"));
    cursor.style.left = pos.left + "px";
    cursor.style.top = pos.top + "px";
    cursor.style.height = Math.max(0, pos.bottom - pos.top) * cm.options.cursorHeight + "px";

    if (pos.other) {
      // Secondary cursor, shown when on a 'jump' in bi-directional text
      var otherCursor = output.appendChild(elt("div", "\u00a0", "CodeMirror-cursor CodeMirror-secondarycursor"));
      otherCursor.style.display = "";
      otherCursor.style.left = pos.other.left + "px";
      otherCursor.style.top = pos.other.top + "px";
      otherCursor.style.height = (pos.other.bottom - pos.other.top) * .85 + "px";
    }
  }

  // Draws the given range as a highlighted selection
  function drawSelectionRange(cm, range, output) {
    var display = cm.display, doc = cm.doc;
    var fragment = document.createDocumentFragment();
    var padding = paddingH(cm.display), leftSide = padding.left;
    var rightSide = Math.max(display.sizerWidth, displayWidth(cm) - display.sizer.offsetLeft) - padding.right;

    function add(left, top, width, bottom) {
      if (top < 0) top = 0;
      top = Math.round(top);
      bottom = Math.round(bottom);
      fragment.appendChild(elt("div", null, "CodeMirror-selected", "position: absolute; left: " + left +
                               "px; top: " + top + "px; width: " + (width == null ? rightSide - left : width) +
                               "px; height: " + (bottom - top) + "px"));
    }

    function drawForLine(line, fromArg, toArg) {
      var lineObj = getLine(doc, line);
      var lineLen = lineObj.text.length;
      var start, end;
      function coords(ch, bias) {
        return charCoords(cm, Pos(line, ch), "div", lineObj, bias);
      }

      iterateBidiSections(getOrder(lineObj), fromArg || 0, toArg == null ? lineLen : toArg, function(from, to, dir) {
        var leftPos = coords(from, "left"), rightPos, left, right;
        if (from == to) {
          rightPos = leftPos;
          left = right = leftPos.left;
        } else {
          rightPos = coords(to - 1, "right");
          if (dir == "rtl") { var tmp = leftPos; leftPos = rightPos; rightPos = tmp; }
          left = leftPos.left;
          right = rightPos.right;
        }
        if (fromArg == null && from == 0) left = leftSide;
        if (rightPos.top - leftPos.top > 3) { // Different lines, draw top part
          add(left, leftPos.top, null, leftPos.bottom);
          left = leftSide;
          if (leftPos.bottom < rightPos.top) add(left, leftPos.bottom, null, rightPos.top);
        }
        if (toArg == null && to == lineLen) right = rightSide;
        if (!start || leftPos.top < start.top || leftPos.top == start.top && leftPos.left < start.left)
          start = leftPos;
        if (!end || rightPos.bottom > end.bottom || rightPos.bottom == end.bottom && rightPos.right > end.right)
          end = rightPos;
        if (left < leftSide + 1) left = leftSide;
        add(left, rightPos.top, right - left, rightPos.bottom);
      });
      return {start: start, end: end};
    }

    var sFrom = range.from(), sTo = range.to();
    if (sFrom.line == sTo.line) {
      drawForLine(sFrom.line, sFrom.ch, sTo.ch);
    } else {
      var fromLine = getLine(doc, sFrom.line), toLine = getLine(doc, sTo.line);
      var singleVLine = visualLine(fromLine) == visualLine(toLine);
      var leftEnd = drawForLine(sFrom.line, sFrom.ch, singleVLine ? fromLine.text.length + 1 : null).end;
      var rightStart = drawForLine(sTo.line, singleVLine ? 0 : null, sTo.ch).start;
      if (singleVLine) {
        if (leftEnd.top < rightStart.top - 2) {
          add(leftEnd.right, leftEnd.top, null, leftEnd.bottom);
          add(leftSide, rightStart.top, rightStart.left, rightStart.bottom);
        } else {
          add(leftEnd.right, leftEnd.top, rightStart.left - leftEnd.right, leftEnd.bottom);
        }
      }
      if (leftEnd.bottom < rightStart.top)
        add(leftSide, leftEnd.bottom, null, rightStart.top);
    }

    output.appendChild(fragment);
  }

  // Cursor-blinking
  function restartBlink(cm) {
    if (!cm.state.focused) return;
    var display = cm.display;
    clearInterval(display.blinker);
    var on = true;
    display.cursorDiv.style.visibility = "";
    if (cm.options.cursorBlinkRate > 0)
      display.blinker = setInterval(function() {
        display.cursorDiv.style.visibility = (on = !on) ? "" : "hidden";
      }, cm.options.cursorBlinkRate);
    else if (cm.options.cursorBlinkRate < 0)
      display.cursorDiv.style.visibility = "hidden";
  }

  // HIGHLIGHT WORKER

  function startWorker(cm, time) {
    if (cm.doc.mode.startState && cm.doc.frontier < cm.display.viewTo)
      cm.state.highlight.set(time, bind(highlightWorker, cm));
  }

  function highlightWorker(cm) {
    var doc = cm.doc;
    if (doc.frontier < doc.first) doc.frontier = doc.first;
    if (doc.frontier >= cm.display.viewTo) return;
    var end = +new Date + cm.options.workTime;
    var state = copyState(doc.mode, getStateBefore(cm, doc.frontier));
    var changedLines = [];

    doc.iter(doc.frontier, Math.min(doc.first + doc.size, cm.display.viewTo + 500), function(line) {
      if (doc.frontier >= cm.display.viewFrom) { // Visible
        var oldStyles = line.styles, tooLong = line.text.length > cm.options.maxHighlightLength;
        var highlighted = highlightLine(cm, line, tooLong ? copyState(doc.mode, state) : state, true);
        line.styles = highlighted.styles;
        var oldCls = line.styleClasses, newCls = highlighted.classes;
        if (newCls) line.styleClasses = newCls;
        else if (oldCls) line.styleClasses = null;
        var ischange = !oldStyles || oldStyles.length != line.styles.length ||
          oldCls != newCls && (!oldCls || !newCls || oldCls.bgClass != newCls.bgClass || oldCls.textClass != newCls.textClass);
        for (var i = 0; !ischange && i < oldStyles.length; ++i) ischange = oldStyles[i] != line.styles[i];
        if (ischange) changedLines.push(doc.frontier);
        line.stateAfter = tooLong ? state : copyState(doc.mode, state);
      } else {
        if (line.text.length <= cm.options.maxHighlightLength)
          processLine(cm, line.text, state);
        line.stateAfter = doc.frontier % 5 == 0 ? copyState(doc.mode, state) : null;
      }
      ++doc.frontier;
      if (+new Date > end) {
        startWorker(cm, cm.options.workDelay);
        return true;
      }
    });
    if (changedLines.length) runInOp(cm, function() {
      for (var i = 0; i < changedLines.length; i++)
        regLineChange(cm, changedLines[i], "text");
    });
  }

  // Finds the line to start with when starting a parse. Tries to
  // find a line with a stateAfter, so that it can start with a
  // valid state. If that fails, it returns the line with the
  // smallest indentation, which tends to need the least context to
  // parse correctly.
  function findStartLine(cm, n, precise) {
    var minindent, minline, doc = cm.doc;
    var lim = precise ? -1 : n - (cm.doc.mode.innerMode ? 1000 : 100);
    for (var search = n; search > lim; --search) {
      if (search <= doc.first) return doc.first;
      var line = getLine(doc, search - 1);
      if (line.stateAfter && (!precise || search <= doc.frontier)) return search;
      var indented = countColumn(line.text, null, cm.options.tabSize);
      if (minline == null || minindent > indented) {
        minline = search - 1;
        minindent = indented;
      }
    }
    return minline;
  }

  function getStateBefore(cm, n, precise) {
    var doc = cm.doc, display = cm.display;
    if (!doc.mode.startState) return true;
    var pos = findStartLine(cm, n, precise), state = pos > doc.first && getLine(doc, pos-1).stateAfter;
    if (!state) state = startState(doc.mode);
    else state = copyState(doc.mode, state);
    doc.iter(pos, n, function(line) {
      processLine(cm, line.text, state);
      var save = pos == n - 1 || pos % 5 == 0 || pos >= display.viewFrom && pos < display.viewTo;
      line.stateAfter = save ? copyState(doc.mode, state) : null;
      ++pos;
    });
    if (precise) doc.frontier = pos;
    return state;
  }

  // POSITION MEASUREMENT

  function paddingTop(display) {return display.lineSpace.offsetTop;}
  function paddingVert(display) {return display.mover.offsetHeight - display.lineSpace.offsetHeight;}
  function paddingH(display) {
    if (display.cachedPaddingH) return display.cachedPaddingH;
    var e = removeChildrenAndAdd(display.measure, elt("pre", "x"));
    var style = window.getComputedStyle ? window.getComputedStyle(e) : e.currentStyle;
    var data = {left: parseInt(style.paddingLeft), right: parseInt(style.paddingRight)};
    if (!isNaN(data.left) && !isNaN(data.right)) display.cachedPaddingH = data;
    return data;
  }

  function scrollGap(cm) { return scrollerGap - cm.display.nativeBarWidth; }
  function displayWidth(cm) {
    return cm.display.scroller.clientWidth - scrollGap(cm) - cm.display.barWidth;
  }
  function displayHeight(cm) {
    return cm.display.scroller.clientHeight - scrollGap(cm) - cm.display.barHeight;
  }

  // Ensure the lineView.wrapping.heights array is populated. This is
  // an array of bottom offsets for the lines that make up a drawn
  // line. When lineWrapping is on, there might be more than one
  // height.
  function ensureLineHeights(cm, lineView, rect) {
    var wrapping = cm.options.lineWrapping;
    var curWidth = wrapping && displayWidth(cm);
    if (!lineView.measure.heights || wrapping && lineView.measure.width != curWidth) {
      var heights = lineView.measure.heights = [];
      if (wrapping) {
        lineView.measure.width = curWidth;
        var rects = lineView.text.firstChild.getClientRects();
        for (var i = 0; i < rects.length - 1; i++) {
          var cur = rects[i], next = rects[i + 1];
          if (Math.abs(cur.bottom - next.bottom) > 2)
            heights.push((cur.bottom + next.top) / 2 - rect.top);
        }
      }
      heights.push(rect.bottom - rect.top);
    }
  }

  // Find a line map (mapping character offsets to text nodes) and a
  // measurement cache for the given line number. (A line view might
  // contain multiple lines when collapsed ranges are present.)
  function mapFromLineView(lineView, line, lineN) {
    if (lineView.line == line)
      return {map: lineView.measure.map, cache: lineView.measure.cache};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineView.rest[i] == line)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i]};
    for (var i = 0; i < lineView.rest.length; i++)
      if (lineNo(lineView.rest[i]) > lineN)
        return {map: lineView.measure.maps[i], cache: lineView.measure.caches[i], before: true};
  }

  // Render a line into the hidden node display.externalMeasured. Used
  // when measurement is needed for a line that's not in the viewport.
  function updateExternalMeasurement(cm, line) {
    line = visualLine(line);
    var lineN = lineNo(line);
    var view = cm.display.externalMeasured = new LineView(cm.doc, line, lineN);
    view.lineN = lineN;
    var built = view.built = buildLineContent(cm, view);
    view.text = built.pre;
    removeChildrenAndAdd(cm.display.lineMeasure, built.pre);
    return view;
  }

  // Get a {top, bottom, left, right} box (in line-local coordinates)
  // for a given character.
  function measureChar(cm, line, ch, bias) {
    return measureCharPrepared(cm, prepareMeasureForLine(cm, line), ch, bias);
  }

  // Find a line view that corresponds to the given line number.
  function findViewForLine(cm, lineN) {
    if (lineN >= cm.display.viewFrom && lineN < cm.display.viewTo)
      return cm.display.view[findViewIndex(cm, lineN)];
    var ext = cm.display.externalMeasured;
    if (ext && lineN >= ext.lineN && lineN < ext.lineN + ext.size)
      return ext;
  }

  // Measurement can be split in two steps, the set-up work that
  // applies to the whole line, and the measurement of the actual
  // character. Functions like coordsChar, that need to do a lot of
  // measurements in a row, can thus ensure that the set-up work is
  // only done once.
  function prepareMeasureForLine(cm, line) {
    var lineN = lineNo(line);
    var view = findViewForLine(cm, lineN);
    if (view && !view.text) {
      view = null;
    } else if (view && view.changes) {
      updateLineForChanges(cm, view, lineN, getDimensions(cm));
      cm.curOp.forceUpdate = true;
    }
    if (!view)
      view = updateExternalMeasurement(cm, line);

    var info = mapFromLineView(view, line, lineN);
    return {
      line: line, view: view, rect: null,
      map: info.map, cache: info.cache, before: info.before,
      hasHeights: false
    };
  }

  // Given a prepared measurement object, measures the position of an
  // actual character (or fetches it from the cache).
  function measureCharPrepared(cm, prepared, ch, bias, varHeight) {
    if (prepared.before) ch = -1;
    var key = ch + (bias || ""), found;
    if (prepared.cache.hasOwnProperty(key)) {
      found = prepared.cache[key];
    } else {
      if (!prepared.rect)
        prepared.rect = prepared.view.text.getBoundingClientRect();
      if (!prepared.hasHeights) {
        ensureLineHeights(cm, prepared.view, prepared.rect);
        prepared.hasHeights = true;
      }
      found = measureCharInner(cm, prepared, ch, bias);
      if (!found.bogus) prepared.cache[key] = found;
    }
    return {left: found.left, right: found.right,
            top: varHeight ? found.rtop : found.top,
            bottom: varHeight ? found.rbottom : found.bottom};
  }

  var nullRect = {left: 0, right: 0, top: 0, bottom: 0};

  function nodeAndOffsetInLineMap(map, ch, bias) {
    var node, start, end, collapse;
    // First, search the line map for the text node corresponding to,
    // or closest to, the target character.
    for (var i = 0; i < map.length; i += 3) {
      var mStart = map[i], mEnd = map[i + 1];
      if (ch < mStart) {
        start = 0; end = 1;
        collapse = "left";
      } else if (ch < mEnd) {
        start = ch - mStart;
        end = start + 1;
      } else if (i == map.length - 3 || ch == mEnd && map[i + 3] > ch) {
        end = mEnd - mStart;
        start = end - 1;
        if (ch >= mEnd) collapse = "right";
      }
      if (start != null) {
        node = map[i + 2];
        if (mStart == mEnd && bias == (node.insertLeft ? "left" : "right"))
          collapse = bias;
        if (bias == "left" && start == 0)
          while (i && map[i - 2] == map[i - 3] && map[i - 1].insertLeft) {
            node = map[(i -= 3) + 2];
            collapse = "left";
          }
        if (bias == "right" && start == mEnd - mStart)
          while (i < map.length - 3 && map[i + 3] == map[i + 4] && !map[i + 5].insertLeft) {
            node = map[(i += 3) + 2];
            collapse = "right";
          }
        break;
      }
    }
    return {node: node, start: start, end: end, collapse: collapse, coverStart: mStart, coverEnd: mEnd};
  }

  function measureCharInner(cm, prepared, ch, bias) {
    var place = nodeAndOffsetInLineMap(prepared.map, ch, bias);
    var node = place.node, start = place.start, end = place.end, collapse = place.collapse;

    var rect;
    if (node.nodeType == 3) { // If it is a text node, use a range to retrieve the coordinates.
      for (var i = 0; i < 4; i++) { // Retry a maximum of 4 times when nonsense rectangles are returned
        while (start && isExtendingChar(prepared.line.text.charAt(place.coverStart + start))) --start;
        while (place.coverStart + end < place.coverEnd && isExtendingChar(prepared.line.text.charAt(place.coverStart + end))) ++end;
        if (ie && ie_version < 9 && start == 0 && end == place.coverEnd - place.coverStart) {
          rect = node.parentNode.getBoundingClientRect();
        } else if (ie && cm.options.lineWrapping) {
          var rects = range(node, start, end).getClientRects();
          if (rects.length)
            rect = rects[bias == "right" ? rects.length - 1 : 0];
          else
            rect = nullRect;
        } else {
          rect = range(node, start, end).getBoundingClientRect() || nullRect;
        }
        if (rect.left || rect.right || start == 0) break;
        end = start;
        start = start - 1;
        collapse = "right";
      }
      if (ie && ie_version < 11) rect = maybeUpdateRectForZooming(cm.display.measure, rect);
    } else { // If it is a widget, simply get the box for the whole widget.
      if (start > 0) collapse = bias = "right";
      var rects;
      if (cm.options.lineWrapping && (rects = node.getClientRects()).length > 1)
        rect = rects[bias == "right" ? rects.length - 1 : 0];
      else
        rect = node.getBoundingClientRect();
    }
    if (ie && ie_version < 9 && !start && (!rect || !rect.left && !rect.right)) {
      var rSpan = node.parentNode.getClientRects()[0];
      if (rSpan)
        rect = {left: rSpan.left, right: rSpan.left + charWidth(cm.display), top: rSpan.top, bottom: rSpan.bottom};
      else
        rect = nullRect;
    }

    var rtop = rect.top - prepared.rect.top, rbot = rect.bottom - prepared.rect.top;
    var mid = (rtop + rbot) / 2;
    var heights = prepared.view.measure.heights;
    for (var i = 0; i < heights.length - 1; i++)
      if (mid < heights[i]) break;
    var top = i ? heights[i - 1] : 0, bot = heights[i];
    var result = {left: (collapse == "right" ? rect.right : rect.left) - prepared.rect.left,
                  right: (collapse == "left" ? rect.left : rect.right) - prepared.rect.left,
                  top: top, bottom: bot};
    if (!rect.left && !rect.right) result.bogus = true;
    if (!cm.options.singleCursorHeightPerLine) { result.rtop = rtop; result.rbottom = rbot; }

    return result;
  }

  // Work around problem with bounding client rects on ranges being
  // returned incorrectly when zoomed on IE10 and below.
  function maybeUpdateRectForZooming(measure, rect) {
    if (!window.screen || screen.logicalXDPI == null ||
        screen.logicalXDPI == screen.deviceXDPI || !hasBadZoomedRects(measure))
      return rect;
    var scaleX = screen.logicalXDPI / screen.deviceXDPI;
    var scaleY = screen.logicalYDPI / screen.deviceYDPI;
    return {left: rect.left * scaleX, right: rect.right * scaleX,
            top: rect.top * scaleY, bottom: rect.bottom * scaleY};
  }

  function clearLineMeasurementCacheFor(lineView) {
    if (lineView.measure) {
      lineView.measure.cache = {};
      lineView.measure.heights = null;
      if (lineView.rest) for (var i = 0; i < lineView.rest.length; i++)
        lineView.measure.caches[i] = {};
    }
  }

  function clearLineMeasurementCache(cm) {
    cm.display.externalMeasure = null;
    removeChildren(cm.display.lineMeasure);
    for (var i = 0; i < cm.display.view.length; i++)
      clearLineMeasurementCacheFor(cm.display.view[i]);
  }

  function clearCaches(cm) {
    clearLineMeasurementCache(cm);
    cm.display.cachedCharWidth = cm.display.cachedTextHeight = cm.display.cachedPaddingH = null;
    if (!cm.options.lineWrapping) cm.display.maxLineChanged = true;
    cm.display.lineNumChars = null;
  }

  function pageScrollX() { return window.pageXOffset || (document.documentElement || document.body).scrollLeft; }
  function pageScrollY() { return window.pageYOffset || (document.documentElement || document.body).scrollTop; }

  // Converts a {top, bottom, left, right} box from line-local
  // coordinates into another coordinate system. Context may be one of
  // "line", "div" (display.lineDiv), "local"/null (editor), "window",
  // or "page".
  function intoCoordSystem(cm, lineObj, rect, context) {
    if (lineObj.widgets) for (var i = 0; i < lineObj.widgets.length; ++i) if (lineObj.widgets[i].above) {
      var size = widgetHeight(lineObj.widgets[i]);
      rect.top += size; rect.bottom += size;
    }
    if (context == "line") return rect;
    if (!context) context = "local";
    var yOff = heightAtLine(lineObj);
    if (context == "local") yOff += paddingTop(cm.display);
    else yOff -= cm.display.viewOffset;
    if (context == "page" || context == "window") {
      var lOff = cm.display.lineSpace.getBoundingClientRect();
      yOff += lOff.top + (context == "window" ? 0 : pageScrollY());
      var xOff = lOff.left + (context == "window" ? 0 : pageScrollX());
      rect.left += xOff; rect.right += xOff;
    }
    rect.top += yOff; rect.bottom += yOff;
    return rect;
  }

  // Coverts a box from "div" coords to another coordinate system.
  // Context may be "window", "page", "div", or "local"/null.
  function fromCoordSystem(cm, coords, context) {
    if (context == "div") return coords;
    var left = coords.left, top = coords.top;
    // First move into "page" coordinate system
    if (context == "page") {
      left -= pageScrollX();
      top -= pageScrollY();
    } else if (context == "local" || !context) {
      var localBox = cm.display.sizer.getBoundingClientRect();
      left += localBox.left;
      top += localBox.top;
    }

    var lineSpaceBox = cm.display.lineSpace.getBoundingClientRect();
    return {left: left - lineSpaceBox.left, top: top - lineSpaceBox.top};
  }

  function charCoords(cm, pos, context, lineObj, bias) {
    if (!lineObj) lineObj = getLine(cm.doc, pos.line);
    return intoCoordSystem(cm, lineObj, measureChar(cm, lineObj, pos.ch, bias), context);
  }

  // Returns a box for a given cursor position, which may have an
  // 'other' property containing the position of the secondary cursor
  // on a bidi boundary.
  function cursorCoords(cm, pos, context, lineObj, preparedMeasure, varHeight) {
    lineObj = lineObj || getLine(cm.doc, pos.line);
    if (!preparedMeasure) preparedMeasure = prepareMeasureForLine(cm, lineObj);
    function get(ch, right) {
      var m = measureCharPrepared(cm, preparedMeasure, ch, right ? "right" : "left", varHeight);
      if (right) m.left = m.right; else m.right = m.left;
      return intoCoordSystem(cm, lineObj, m, context);
    }
    function getBidi(ch, partPos) {
      var part = order[partPos], right = part.level % 2;
      if (ch == bidiLeft(part) && partPos && part.level < order[partPos - 1].level) {
        part = order[--partPos];
        ch = bidiRight(part) - (part.level % 2 ? 0 : 1);
        right = true;
      } else if (ch == bidiRight(part) && partPos < order.length - 1 && part.level < order[partPos + 1].level) {
        part = order[++partPos];
        ch = bidiLeft(part) - part.level % 2;
        right = false;
      }
      if (right && ch == part.to && ch > part.from) return get(ch - 1);
      return get(ch, right);
    }
    var order = getOrder(lineObj), ch = pos.ch;
    if (!order) return get(ch);
    var partPos = getBidiPartAt(order, ch);
    var val = getBidi(ch, partPos);
    if (bidiOther != null) val.other = getBidi(ch, bidiOther);
    return val;
  }

  // Used to cheaply estimate the coordinates for a position. Used for
  // intermediate scroll updates.
  function estimateCoords(cm, pos) {
    var left = 0, pos = clipPos(cm.doc, pos);
    if (!cm.options.lineWrapping) left = charWidth(cm.display) * pos.ch;
    var lineObj = getLine(cm.doc, pos.line);
    var top = heightAtLine(lineObj) + paddingTop(cm.display);
    return {left: left, right: left, top: top, bottom: top + lineObj.height};
  }

  // Positions returned by coordsChar contain some extra information.
  // xRel is the relative x position of the input coordinates compared
  // to the found position (so xRel > 0 means the coordinates are to
  // the right of the character position, for example). When outside
  // is true, that means the coordinates lie outside the line's
  // vertical range.
  function PosWithInfo(line, ch, outside, xRel) {
    var pos = Pos(line, ch);
    pos.xRel = xRel;
    if (outside) pos.outside = true;
    return pos;
  }

  // Compute the character position closest to the given coordinates.
  // Input must be lineSpace-local ("div" coordinate system).
  function coordsChar(cm, x, y) {
    var doc = cm.doc;
    y += cm.display.viewOffset;
    if (y < 0) return PosWithInfo(doc.first, 0, true, -1);
    var lineN = lineAtHeight(doc, y), last = doc.first + doc.size - 1;
    if (lineN > last)
      return PosWithInfo(doc.first + doc.size - 1, getLine(doc, last).text.length, true, 1);
    if (x < 0) x = 0;

    var lineObj = getLine(doc, lineN);
    for (;;) {
      var found = coordsCharInner(cm, lineObj, lineN, x, y);
      var merged = collapsedSpanAtEnd(lineObj);
      var mergedPos = merged && merged.find(0, true);
      if (merged && (found.ch > mergedPos.from.ch || found.ch == mergedPos.from.ch && found.xRel > 0))
        lineN = lineNo(lineObj = mergedPos.to.line);
      else
        return found;
    }
  }

  function coordsCharInner(cm, lineObj, lineNo, x, y) {
    var innerOff = y - heightAtLine(lineObj);
    var wrongLine = false, adjust = 2 * cm.display.wrapper.clientWidth;
    var preparedMeasure = prepareMeasureForLine(cm, lineObj);

    function getX(ch) {
      var sp = cursorCoords(cm, Pos(lineNo, ch), "line", lineObj, preparedMeasure);
      wrongLine = true;
      if (innerOff > sp.bottom) return sp.left - adjust;
      else if (innerOff < sp.top) return sp.left + adjust;
      else wrongLine = false;
      return sp.left;
    }

    var bidi = getOrder(lineObj), dist = lineObj.text.length;
    var from = lineLeft(lineObj), to = lineRight(lineObj);
    var fromX = getX(from), fromOutside = wrongLine, toX = getX(to), toOutside = wrongLine;

    if (x > toX) return PosWithInfo(lineNo, to, toOutside, 1);
    // Do a binary search between these bounds.
    for (;;) {
      if (bidi ? to == from || to == moveVisually(lineObj, from, 1) : to - from <= 1) {
        var ch = x < fromX || x - fromX <= toX - x ? from : to;
        var xDiff = x - (ch == from ? fromX : toX);
        while (isExtendingChar(lineObj.text.charAt(ch))) ++ch;
        var pos = PosWithInfo(lineNo, ch, ch == from ? fromOutside : toOutside,
                              xDiff < -1 ? -1 : xDiff > 1 ? 1 : 0);
        return pos;
      }
      var step = Math.ceil(dist / 2), middle = from + step;
      if (bidi) {
        middle = from;
        for (var i = 0; i < step; ++i) middle = moveVisually(lineObj, middle, 1);
      }
      var middleX = getX(middle);
      if (middleX > x) {to = middle; toX = middleX; if (toOutside = wrongLine) toX += 1000; dist = step;}
      else {from = middle; fromX = middleX; fromOutside = wrongLine; dist -= step;}
    }
  }

  var measureText;
  // Compute the default text height.
  function textHeight(display) {
    if (display.cachedTextHeight != null) return display.cachedTextHeight;
    if (measureText == null) {
      measureText = elt("pre");
      // Measure a bunch of lines, for browsers that compute
      // fractional heights.
      for (var i = 0; i < 49; ++i) {
        measureText.appendChild(document.createTextNode("x"));
        measureText.appendChild(elt("br"));
      }
      measureText.appendChild(document.createTextNode("x"));
    }
    removeChildrenAndAdd(display.measure, measureText);
    var height = measureText.offsetHeight / 50;
    if (height > 3) display.cachedTextHeight = height;
    removeChildren(display.measure);
    return height || 1;
  }

  // Compute the default character width.
  function charWidth(display) {
    if (display.cachedCharWidth != null) return display.cachedCharWidth;
    var anchor = elt("span", "xxxxxxxxxx");
    var pre = elt("pre", [anchor]);
    removeChildrenAndAdd(display.measure, pre);
    var rect = anchor.getBoundingClientRect(), width = (rect.right - rect.left) / 10;
    if (width > 2) display.cachedCharWidth = width;
    return width || 10;
  }

  // OPERATIONS

  // Operations are used to wrap a series of changes to the editor
  // state in such a way that each change won't have to update the
  // cursor and display (which would be awkward, slow, and
  // error-prone). Instead, display updates are batched and then all
  // combined and executed at once.

  var operationGroup = null;

  var nextOpId = 0;
  // Start a new operation.
  function startOperation(cm) {
    cm.curOp = {
      cm: cm,
      viewChanged: false,      // Flag that indicates that lines might need to be redrawn
      startHeight: cm.doc.height, // Used to detect need to update scrollbar
      forceUpdate: false,      // Used to force a redraw
      updateInput: null,       // Whether to reset the input textarea
      typing: false,           // Whether this reset should be careful to leave existing text (for compositing)
      changeObjs: null,        // Accumulated changes, for firing change events
      cursorActivityHandlers: null, // Set of handlers to fire cursorActivity on
      cursorActivityCalled: 0, // Tracks which cursorActivity handlers have been called already
      selectionChanged: false, // Whether the selection needs to be redrawn
      updateMaxLine: false,    // Set when the widest line needs to be determined anew
      scrollLeft: null, scrollTop: null, // Intermediate scroll position, not pushed to DOM yet
      scrollToPos: null,       // Used to scroll to a specific position
      focus: false,
      id: ++nextOpId           // Unique ID
    };
    if (operationGroup) {
      operationGroup.ops.push(cm.curOp);
    } else {
      cm.curOp.ownsGroup = operationGroup = {
        ops: [cm.curOp],
        delayedCallbacks: []
      };
    }
  }

  function fireCallbacksForOps(group) {
    // Calls delayed callbacks and cursorActivity handlers until no
    // new ones appear
    var callbacks = group.delayedCallbacks, i = 0;
    do {
      for (; i < callbacks.length; i++)
        callbacks[i].call(null);
      for (var j = 0; j < group.ops.length; j++) {
        var op = group.ops[j];
        if (op.cursorActivityHandlers)
          while (op.cursorActivityCalled < op.cursorActivityHandlers.length)
            op.cursorActivityHandlers[op.cursorActivityCalled++].call(null, op.cm);
      }
    } while (i < callbacks.length);
  }

  // Finish an operation, updating the display and signalling delayed events
  function endOperation(cm) {
    var op = cm.curOp, group = op.ownsGroup;
    if (!group) return;

    try { fireCallbacksForOps(group); }
    finally {
      operationGroup = null;
      for (var i = 0; i < group.ops.length; i++)
        group.ops[i].cm.curOp = null;
      endOperations(group);
    }
  }

  // The DOM updates done when an operation finishes are batched so
  // that the minimum number of relayouts are required.
  function endOperations(group) {
    var ops = group.ops;
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W1(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_R2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Write DOM (maybe)
      endOperation_W2(ops[i]);
    for (var i = 0; i < ops.length; i++) // Read DOM
      endOperation_finish(ops[i]);
  }

  function endOperation_R1(op) {
    var cm = op.cm, display = cm.display;
    maybeClipScrollbars(cm);
    if (op.updateMaxLine) findMaxLine(cm);

    op.mustUpdate = op.viewChanged || op.forceUpdate || op.scrollTop != null ||
      op.scrollToPos && (op.scrollToPos.from.line < display.viewFrom ||
                         op.scrollToPos.to.line >= display.viewTo) ||
      display.maxLineChanged && cm.options.lineWrapping;
    op.update = op.mustUpdate &&
      new DisplayUpdate(cm, op.mustUpdate && {top: op.scrollTop, ensure: op.scrollToPos}, op.forceUpdate);
  }

  function endOperation_W1(op) {
    op.updatedDisplay = op.mustUpdate && updateDisplayIfNeeded(op.cm, op.update);
  }

  function endOperation_R2(op) {
    var cm = op.cm, display = cm.display;
    if (op.updatedDisplay) updateHeightsInViewport(cm);

    op.barMeasure = measureForScrollbars(cm);

    // If the max line changed since it was last measured, measure it,
    // and ensure the document's width matches it.
    // updateDisplay_W2 will use these properties to do the actual resizing
    if (display.maxLineChanged && !cm.options.lineWrapping) {
      op.adjustWidthTo = measureChar(cm, display.maxLine, display.maxLine.text.length).left + 3;
      cm.display.sizerWidth = op.adjustWidthTo;
      op.barMeasure.scrollWidth =
        Math.max(display.scroller.clientWidth, display.sizer.offsetLeft + op.adjustWidthTo + scrollGap(cm) + cm.display.barWidth);
      op.maxScrollLeft = Math.max(0, display.sizer.offsetLeft + op.adjustWidthTo - displayWidth(cm));
    }

    if (op.updatedDisplay || op.selectionChanged)
      op.preparedSelection = display.input.prepareSelection();
  }

  function endOperation_W2(op) {
    var cm = op.cm;

    if (op.adjustWidthTo != null) {
      cm.display.sizer.style.minWidth = op.adjustWidthTo + "px";
      if (op.maxScrollLeft < cm.doc.scrollLeft)
        setScrollLeft(cm, Math.min(cm.display.scroller.scrollLeft, op.maxScrollLeft), true);
      cm.display.maxLineChanged = false;
    }

    if (op.preparedSelection)
      cm.display.input.showSelection(op.preparedSelection);
    if (op.updatedDisplay)
      setDocumentHeight(cm, op.barMeasure);
    if (op.updatedDisplay || op.startHeight != cm.doc.height)
      updateScrollbars(cm, op.barMeasure);

    if (op.selectionChanged) restartBlink(cm);

    if (cm.state.focused && op.updateInput)
      cm.display.input.reset(op.typing);
    if (op.focus && op.focus == activeElt()) ensureFocus(op.cm);
  }

  function endOperation_finish(op) {
    var cm = op.cm, display = cm.display, doc = cm.doc;

    if (op.updatedDisplay) postUpdateDisplay(cm, op.update);

    // Abort mouse wheel delta measurement, when scrolling explicitly
    if (display.wheelStartX != null && (op.scrollTop != null || op.scrollLeft != null || op.scrollToPos))
      display.wheelStartX = display.wheelStartY = null;

    // Propagate the scroll position to the actual DOM scroller
    if (op.scrollTop != null && (display.scroller.scrollTop != op.scrollTop || op.forceScroll)) {
      doc.scrollTop = Math.max(0, Math.min(display.scroller.scrollHeight - display.scroller.clientHeight, op.scrollTop));
      display.scrollbars.setScrollTop(doc.scrollTop);
      display.scroller.scrollTop = doc.scrollTop;
    }
    if (op.scrollLeft != null && (display.scroller.scrollLeft != op.scrollLeft || op.forceScroll)) {
      doc.scrollLeft = Math.max(0, Math.min(display.scroller.scrollWidth - displayWidth(cm), op.scrollLeft));
      display.scrollbars.setScrollLeft(doc.scrollLeft);
      display.scroller.scrollLeft = doc.scrollLeft;
      alignHorizontally(cm);
    }
    // If we need to scroll a specific position into view, do so.
    if (op.scrollToPos) {
      var coords = scrollPosIntoView(cm, clipPos(doc, op.scrollToPos.from),
                                     clipPos(doc, op.scrollToPos.to), op.scrollToPos.margin);
      if (op.scrollToPos.isCursor && cm.state.focused) maybeScrollWindow(cm, coords);
    }

    // Fire events for markers that are hidden/unidden by editing or
    // undoing
    var hidden = op.maybeHiddenMarkers, unhidden = op.maybeUnhiddenMarkers;
    if (hidden) for (var i = 0; i < hidden.length; ++i)
      if (!hidden[i].lines.length) signal(hidden[i], "hide");
    if (unhidden) for (var i = 0; i < unhidden.length; ++i)
      if (unhidden[i].lines.length) signal(unhidden[i], "unhide");

    if (display.wrapper.offsetHeight)
      doc.scrollTop = cm.display.scroller.scrollTop;

    // Fire change events, and delayed event handlers
    if (op.changeObjs)
      signal(cm, "changes", cm, op.changeObjs);
    if (op.update)
      op.update.finish();
  }

  // Run the given function in an operation
  function runInOp(cm, f) {
    if (cm.curOp) return f();
    startOperation(cm);
    try { return f(); }
    finally { endOperation(cm); }
  }
  // Wraps a function in an operation. Returns the wrapped function.
  function operation(cm, f) {
    return function() {
      if (cm.curOp) return f.apply(cm, arguments);
      startOperation(cm);
      try { return f.apply(cm, arguments); }
      finally { endOperation(cm); }
    };
  }
  // Used to add methods to editor and doc instances, wrapping them in
  // operations.
  function methodOp(f) {
    return function() {
      if (this.curOp) return f.apply(this, arguments);
      startOperation(this);
      try { return f.apply(this, arguments); }
      finally { endOperation(this); }
    };
  }
  function docMethodOp(f) {
    return function() {
      var cm = this.cm;
      if (!cm || cm.curOp) return f.apply(this, arguments);
      startOperation(cm);
      try { return f.apply(this, arguments); }
      finally { endOperation(cm); }
    };
  }

  // VIEW TRACKING

  // These objects are used to represent the visible (currently drawn)
  // part of the document. A LineView may correspond to multiple
  // logical lines, if those are connected by collapsed ranges.
  function LineView(doc, line, lineN) {
    // The starting line
    this.line = line;
    // Continuing lines, if any
    this.rest = visualLineContinued(line);
    // Number of logical lines in this visual line
    this.size = this.rest ? lineNo(lst(this.rest)) - lineN + 1 : 1;
    this.node = this.text = null;
    this.hidden = lineIsHidden(doc, line);
  }

  // Create a range of LineView objects for the given lines.
  function buildViewArray(cm, from, to) {
    var array = [], nextPos;
    for (var pos = from; pos < to; pos = nextPos) {
      var view = new LineView(cm.doc, getLine(cm.doc, pos), pos);
      nextPos = pos + view.size;
      array.push(view);
    }
    return array;
  }

  // Updates the display.view data structure for a given change to the
  // document. From and to are in pre-change coordinates. Lendiff is
  // the amount of lines added or subtracted by the change. This is
  // used for changes that span multiple lines, or change the way
  // lines are divided into visual lines. regLineChange (below)
  // registers single-line changes.
  function regChange(cm, from, to, lendiff) {
    if (from == null) from = cm.doc.first;
    if (to == null) to = cm.doc.first + cm.doc.size;
    if (!lendiff) lendiff = 0;

    var display = cm.display;
    if (lendiff && to < display.viewTo &&
        (display.updateLineNumbers == null || display.updateLineNumbers > from))
      display.updateLineNumbers = from;

    cm.curOp.viewChanged = true;

    if (from >= display.viewTo) { // Change after
      if (sawCollapsedSpans && visualLineNo(cm.doc, from) < display.viewTo)
        resetView(cm);
    } else if (to <= display.viewFrom) { // Change before
      if (sawCollapsedSpans && visualLineEndNo(cm.doc, to + lendiff) > display.viewFrom) {
        resetView(cm);
      } else {
        display.viewFrom += lendiff;
        display.viewTo += lendiff;
      }
    } else if (from <= display.viewFrom && to >= display.viewTo) { // Full overlap
      resetView(cm);
    } else if (from <= display.viewFrom) { // Top overlap
      var cut = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cut) {
        display.view = display.view.slice(cut.index);
        display.viewFrom = cut.lineN;
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    } else if (to >= display.viewTo) { // Bottom overlap
      var cut = viewCuttingPoint(cm, from, from, -1);
      if (cut) {
        display.view = display.view.slice(0, cut.index);
        display.viewTo = cut.lineN;
      } else {
        resetView(cm);
      }
    } else { // Gap in the middle
      var cutTop = viewCuttingPoint(cm, from, from, -1);
      var cutBot = viewCuttingPoint(cm, to, to + lendiff, 1);
      if (cutTop && cutBot) {
        display.view = display.view.slice(0, cutTop.index)
          .concat(buildViewArray(cm, cutTop.lineN, cutBot.lineN))
          .concat(display.view.slice(cutBot.index));
        display.viewTo += lendiff;
      } else {
        resetView(cm);
      }
    }

    var ext = display.externalMeasured;
    if (ext) {
      if (to < ext.lineN)
        ext.lineN += lendiff;
      else if (from < ext.lineN + ext.size)
        display.externalMeasured = null;
    }
  }

  // Register a change to a single line. Type must be one of "text",
  // "gutter", "class", "widget"
  function regLineChange(cm, line, type) {
    cm.curOp.viewChanged = true;
    var display = cm.display, ext = cm.display.externalMeasured;
    if (ext && line >= ext.lineN && line < ext.lineN + ext.size)
      display.externalMeasured = null;

    if (line < display.viewFrom || line >= display.viewTo) return;
    var lineView = display.view[findViewIndex(cm, line)];
    if (lineView.node == null) return;
    var arr = lineView.changes || (lineView.changes = []);
    if (indexOf(arr, type) == -1) arr.push(type);
  }

  // Clear the view.
  function resetView(cm) {
    cm.display.viewFrom = cm.display.viewTo = cm.doc.first;
    cm.display.view = [];
    cm.display.viewOffset = 0;
  }

  // Find the view element corresponding to a given line. Return null
  // when the line isn't visible.
  function findViewIndex(cm, n) {
    if (n >= cm.display.viewTo) return null;
    n -= cm.display.viewFrom;
    if (n < 0) return null;
    var view = cm.display.view;
    for (var i = 0; i < view.length; i++) {
      n -= view[i].size;
      if (n < 0) return i;
    }
  }

  function viewCuttingPoint(cm, oldN, newN, dir) {
    var index = findViewIndex(cm, oldN), diff, view = cm.display.view;
    if (!sawCollapsedSpans || newN == cm.doc.first + cm.doc.size)
      return {index: index, lineN: newN};
    for (var i = 0, n = cm.display.viewFrom; i < index; i++)
      n += view[i].size;
    if (n != oldN) {
      if (dir > 0) {
        if (index == view.length - 1) return null;
        diff = (n + view[index].size) - oldN;
        index++;
      } else {
        diff = n - oldN;
      }
      oldN += diff; newN += diff;
    }
    while (visualLineNo(cm.doc, newN) != newN) {
      if (index == (dir < 0 ? 0 : view.length - 1)) return null;
      newN += dir * view[index - (dir < 0 ? 1 : 0)].size;
      index += dir;
    }
    return {index: index, lineN: newN};
  }

  // Force the view to cover a given range, adding empty view element
  // or clipping off existing ones as needed.
  function adjustView(cm, from, to) {
    var display = cm.display, view = display.view;
    if (view.length == 0 || from >= display.viewTo || to <= display.viewFrom) {
      display.view = buildViewArray(cm, from, to);
      display.viewFrom = from;
    } else {
      if (display.viewFrom > from)
        display.view = buildViewArray(cm, from, display.viewFrom).concat(display.view);
      else if (display.viewFrom < from)
        display.view = display.view.slice(findViewIndex(cm, from));
      display.viewFrom = from;
      if (display.viewTo < to)
        display.view = display.view.concat(buildViewArray(cm, display.viewTo, to));
      else if (display.viewTo > to)
        display.view = display.view.slice(0, findViewIndex(cm, to));
    }
    display.viewTo = to;
  }

  // Count the number of lines in the view whose DOM representation is
  // out of date (or nonexistent).
  function countDirtyView(cm) {
    var view = cm.display.view, dirty = 0;
    for (var i = 0; i < view.length; i++) {
      var lineView = view[i];
      if (!lineView.hidden && (!lineView.node || lineView.changes)) ++dirty;
    }
    return dirty;
  }

  // EVENT HANDLERS

  // Attach the necessary event handlers when initializing the editor
  function registerEventHandlers(cm) {
    var d = cm.display;
    on(d.scroller, "mousedown", operation(cm, onMouseDown));
    // Older IE's will not fire a second mousedown for a double click
    if (ie && ie_version < 11)
      on(d.scroller, "dblclick", operation(cm, function(e) {
        if (signalDOMEvent(cm, e)) return;
        var pos = posFromMouse(cm, e);
        if (!pos || clickInGutter(cm, e) || eventInWidget(cm.display, e)) return;
        e_preventDefault(e);
        var word = cm.findWordAt(pos);
        extendSelection(cm.doc, word.anchor, word.head);
      }));
    else
      on(d.scroller, "dblclick", function(e) { signalDOMEvent(cm, e) || e_preventDefault(e); });
    // Some browsers fire contextmenu *after* opening the menu, at
    // which point we can't mess with it anymore. Context menu is
    // handled in onMouseDown for these browsers.
    if (!captureRightClick) on(d.scroller, "contextmenu", function(e) {onContextMenu(cm, e);});

    // Used to suppress mouse event handling when a touch happens
    var touchFinished, prevTouch = {end: 0};
    function finishTouch() {
      if (d.activeTouch) {
        touchFinished = setTimeout(function() {d.activeTouch = null;}, 1000);
        prevTouch = d.activeTouch;
        prevTouch.end = +new Date;
      }
    };
    function isMouseLikeTouchEvent(e) {
      if (e.touches.length != 1) return false;
      var touch = e.touches[0];
      return touch.radiusX <= 1 && touch.radiusY <= 1;
    }
    function farAway(touch, other) {
      if (other.left == null) return true;
      var dx = other.left - touch.left, dy = other.top - touch.top;
      return dx * dx + dy * dy > 20 * 20;
    }
    on(d.scroller, "touchstart", function(e) {
      if (!isMouseLikeTouchEvent(e)) {
        clearTimeout(touchFinished);
        var now = +new Date;
        d.activeTouch = {start: now, moved: false,
                         prev: now - prevTouch.end <= 300 ? prevTouch : null};
        if (e.touches.length == 1) {
          d.activeTouch.left = e.touches[0].pageX;
          d.activeTouch.top = e.touches[0].pageY;
        }
      }
    });
    on(d.scroller, "touchmove", function() {
      if (d.activeTouch) d.activeTouch.moved = true;
    });
    on(d.scroller, "touchend", function(e) {
      var touch = d.activeTouch;
      if (touch && !eventInWidget(d, e) && touch.left != null &&
          !touch.moved && new Date - touch.start < 300) {
        var pos = cm.coordsChar(d.activeTouch, "page"), range;
        if (!touch.prev || farAway(touch, touch.prev)) // Single tap
          range = new Range(pos, pos);
        else if (!touch.prev.prev || farAway(touch, touch.prev.prev)) // Double tap
          range = cm.findWordAt(pos);
        else // Triple tap
          range = new Range(Pos(pos.line, 0), clipPos(cm.doc, Pos(pos.line + 1, 0)));
        cm.setSelection(range.anchor, range.head);
        cm.focus();
        e_preventDefault(e);
      }
      finishTouch();
    });
    on(d.scroller, "touchcancel", finishTouch);

    // Sync scrolling between fake scrollbars and real scrollable
    // area, ensure viewport is updated when scrolling.
    on(d.scroller, "scroll", function() {
      if (d.scroller.clientHeight) {
        setScrollTop(cm, d.scroller.scrollTop);
        setScrollLeft(cm, d.scroller.scrollLeft, true);
        signal(cm, "scroll", cm);
      }
    });

    // Listen to wheel events in order to try and update the viewport on time.
    on(d.scroller, "mousewheel", function(e){onScrollWheel(cm, e);});
    on(d.scroller, "DOMMouseScroll", function(e){onScrollWheel(cm, e);});

    // Prevent wrapper from ever scrolling
    on(d.wrapper, "scroll", function() { d.wrapper.scrollTop = d.wrapper.scrollLeft = 0; });

    d.dragFunctions = {
      enter: function(e) {if (!signalDOMEvent(cm, e)) e_stop(e);},
      over: function(e) {if (!signalDOMEvent(cm, e)) { onDragOver(cm, e); e_stop(e); }},
      start: function(e){onDragStart(cm, e);},
      drop: operation(cm, onDrop),
      leave: function() {clearDragCursor(cm);}
    };

    var inp = d.input.getField();
    on(inp, "keyup", function(e) { onKeyUp.call(cm, e); });
    on(inp, "keydown", operation(cm, onKeyDown));
    on(inp, "keypress", operation(cm, onKeyPress));
    on(inp, "focus", bind(onFocus, cm));
    on(inp, "blur", bind(onBlur, cm));
  }

  function dragDropChanged(cm, value, old) {
    var wasOn = old && old != CodeMirror.Init;
    if (!value != !wasOn) {
      var funcs = cm.display.dragFunctions;
      var toggle = value ? on : off;
      toggle(cm.display.scroller, "dragstart", funcs.start);
      toggle(cm.display.scroller, "dragenter", funcs.enter);
      toggle(cm.display.scroller, "dragover", funcs.over);
      toggle(cm.display.scroller, "dragleave", funcs.leave);
      toggle(cm.display.scroller, "drop", funcs.drop);
    }
  }

  // Called when the window resizes
  function onResize(cm) {
    var d = cm.display;
    if (d.lastWrapHeight == d.wrapper.clientHeight && d.lastWrapWidth == d.wrapper.clientWidth)
      return;
    // Might be a text scaling operation, clear size caches.
    d.cachedCharWidth = d.cachedTextHeight = d.cachedPaddingH = null;
    d.scrollbarsClipped = false;
    cm.setSize();
  }

  // MOUSE EVENTS

  // Return true when the given mouse event happened in a widget
  function eventInWidget(display, e) {
    for (var n = e_target(e); n != display.wrapper; n = n.parentNode) {
      if (!n || (n.nodeType == 1 && n.getAttribute("cm-ignore-events") == "true") ||
          (n.parentNode == display.sizer && n != display.mover))
        return true;
    }
  }

  // Given a mouse event, find the corresponding position. If liberal
  // is false, it checks whether a gutter or scrollbar was clicked,
  // and returns null if it was. forRect is used by rectangular
  // selections, and tries to estimate a character position even for
  // coordinates beyond the right of the text.
  function posFromMouse(cm, e, liberal, forRect) {
    var display = cm.display;
    if (!liberal && e_target(e).getAttribute("cm-not-content") == "true") return null;

    var x, y, space = display.lineSpace.getBoundingClientRect();
    // Fails unpredictably on IE[67] when mouse is dragged around quickly.
    try { x = e.clientX - space.left; y = e.clientY - space.top; }
    catch (e) { return null; }
    var coords = coordsChar(cm, x, y), line;
    if (forRect && coords.xRel == 1 && (line = getLine(cm.doc, coords.line).text).length == coords.ch) {
      var colDiff = countColumn(line, line.length, cm.options.tabSize) - line.length;
      coords = Pos(coords.line, Math.max(0, Math.round((x - paddingH(cm.display).left) / charWidth(cm.display)) - colDiff));
    }
    return coords;
  }

  // A mouse down can be a single click, double click, triple click,
  // start of selection drag, start of text drag, new cursor
  // (ctrl-click), rectangle drag (alt-drag), or xwin
  // middle-click-paste. Or it might be a click on something we should
  // not interfere with, such as a scrollbar or widget.
  function onMouseDown(e) {
    var cm = this, display = cm.display;
    if (display.activeTouch && display.input.supportsTouch() || signalDOMEvent(cm, e)) return;
    display.shift = e.shiftKey;

    if (eventInWidget(display, e)) {
      if (!webkit) {
        // Briefly turn off draggability, to allow widgets to do
        // normal dragging things.
        display.scroller.draggable = false;
        setTimeout(function(){display.scroller.draggable = true;}, 100);
      }
      return;
    }
    if (clickInGutter(cm, e)) return;
    var start = posFromMouse(cm, e);
    window.focus();

    switch (e_button(e)) {
    case 1:
      // #3261: make sure, that we're not starting a second selection
      if (cm.state.selectingText)
        cm.state.selectingText(e);
      else if (start)
        leftButtonDown(cm, e, start);
      else if (e_target(e) == display.scroller)
        e_preventDefault(e);
      break;
    case 2:
      if (webkit) cm.state.lastMiddleDown = +new Date;
      if (start) extendSelection(cm.doc, start);
      setTimeout(function() {display.input.focus();}, 20);
      e_preventDefault(e);
      break;
    case 3:
      if (captureRightClick) onContextMenu(cm, e);
      else delayBlurEvent(cm);
      break;
    }
  }

  var lastClick, lastDoubleClick;
  function leftButtonDown(cm, e, start) {
    if (ie) setTimeout(bind(ensureFocus, cm), 0);
    else cm.curOp.focus = activeElt();

    var now = +new Date, type;
    if (lastDoubleClick && lastDoubleClick.time > now - 400 && cmp(lastDoubleClick.pos, start) == 0) {
      type = "triple";
    } else if (lastClick && lastClick.time > now - 400 && cmp(lastClick.pos, start) == 0) {
      type = "double";
      lastDoubleClick = {time: now, pos: start};
    } else {
      type = "single";
      lastClick = {time: now, pos: start};
    }

    var sel = cm.doc.sel, modifier = mac ? e.metaKey : e.ctrlKey, contained;
    if (cm.options.dragDrop && dragAndDrop && !isReadOnly(cm) &&
        type == "single" && (contained = sel.contains(start)) > -1 &&
        (cmp((contained = sel.ranges[contained]).from(), start) < 0 || start.xRel > 0) &&
        (cmp(contained.to(), start) > 0 || start.xRel < 0))
      leftButtonStartDrag(cm, e, start, modifier);
    else
      leftButtonSelect(cm, e, start, type, modifier);
  }

  // Start a text drag. When it ends, see if any dragging actually
  // happen, and treat as a click if it didn't.
  function leftButtonStartDrag(cm, e, start, modifier) {
    var display = cm.display, startTime = +new Date;
    var dragEnd = operation(cm, function(e2) {
      if (webkit) display.scroller.draggable = false;
      cm.state.draggingText = false;
      off(document, "mouseup", dragEnd);
      off(display.scroller, "drop", dragEnd);
      if (Math.abs(e.clientX - e2.clientX) + Math.abs(e.clientY - e2.clientY) < 10) {
        e_preventDefault(e2);
        if (!modifier && +new Date - 200 < startTime)
          extendSelection(cm.doc, start);
        // Work around unexplainable focus problem in IE9 (#2127) and Chrome (#3081)
        if (webkit || ie && ie_version == 9)
          setTimeout(function() {document.body.focus(); display.input.focus();}, 20);
        else
          display.input.focus();
      }
    });
    // Let the drag handler handle this.
    if (webkit) display.scroller.draggable = true;
    cm.state.draggingText = dragEnd;
    // IE's approach to draggable
    if (display.scroller.dragDrop) display.scroller.dragDrop();
    on(document, "mouseup", dragEnd);
    on(display.scroller, "drop", dragEnd);
  }

  // Normal selection, as opposed to text dragging.
  function leftButtonSelect(cm, e, start, type, addNew) {
    var display = cm.display, doc = cm.doc;
    e_preventDefault(e);

    var ourRange, ourIndex, startSel = doc.sel, ranges = startSel.ranges;
    if (addNew && !e.shiftKey) {
      ourIndex = doc.sel.contains(start);
      if (ourIndex > -1)
        ourRange = ranges[ourIndex];
      else
        ourRange = new Range(start, start);
    } else {
      ourRange = doc.sel.primary();
      ourIndex = doc.sel.primIndex;
    }

    if (e.altKey) {
      type = "rect";
      if (!addNew) ourRange = new Range(start, start);
      start = posFromMouse(cm, e, true, true);
      ourIndex = -1;
    } else if (type == "double") {
      var word = cm.findWordAt(start);
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, word.anchor, word.head);
      else
        ourRange = word;
    } else if (type == "triple") {
      var line = new Range(Pos(start.line, 0), clipPos(doc, Pos(start.line + 1, 0)));
      if (cm.display.shift || doc.extend)
        ourRange = extendRange(doc, ourRange, line.anchor, line.head);
      else
        ourRange = line;
    } else {
      ourRange = extendRange(doc, ourRange, start);
    }

    if (!addNew) {
      ourIndex = 0;
      setSelection(doc, new Selection([ourRange], 0), sel_mouse);
      startSel = doc.sel;
    } else if (ourIndex == -1) {
      ourIndex = ranges.length;
      setSelection(doc, normalizeSelection(ranges.concat([ourRange]), ourIndex),
                   {scroll: false, origin: "*mouse"});
    } else if (ranges.length > 1 && ranges[ourIndex].empty() && type == "single" && !e.shiftKey) {
      setSelection(doc, normalizeSelection(ranges.slice(0, ourIndex).concat(ranges.slice(ourIndex + 1)), 0),
                   {scroll: false, origin: "*mouse"});
      startSel = doc.sel;
    } else {
      replaceOneSelection(doc, ourIndex, ourRange, sel_mouse);
    }

    var lastPos = start;
    function extendTo(pos) {
      if (cmp(lastPos, pos) == 0) return;
      lastPos = pos;

      if (type == "rect") {
        var ranges = [], tabSize = cm.options.tabSize;
        var startCol = countColumn(getLine(doc, start.line).text, start.ch, tabSize);
        var posCol = countColumn(getLine(doc, pos.line).text, pos.ch, tabSize);
        var left = Math.min(startCol, posCol), right = Math.max(startCol, posCol);
        for (var line = Math.min(start.line, pos.line), end = Math.min(cm.lastLine(), Math.max(start.line, pos.line));
             line <= end; line++) {
          var text = getLine(doc, line).text, leftPos = findColumn(text, left, tabSize);
          if (left == right)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, leftPos)));
          else if (text.length > leftPos)
            ranges.push(new Range(Pos(line, leftPos), Pos(line, findColumn(text, right, tabSize))));
        }
        if (!ranges.length) ranges.push(new Range(start, start));
        setSelection(doc, normalizeSelection(startSel.ranges.slice(0, ourIndex).concat(ranges), ourIndex),
                     {origin: "*mouse", scroll: false});
        cm.scrollIntoView(pos);
      } else {
        var oldRange = ourRange;
        var anchor = oldRange.anchor, head = pos;
        if (type != "single") {
          if (type == "double")
            var range = cm.findWordAt(pos);
          else
            var range = new Range(Pos(pos.line, 0), clipPos(doc, Pos(pos.line + 1, 0)));
          if (cmp(range.anchor, anchor) > 0) {
            head = range.head;
            anchor = minPos(oldRange.from(), range.anchor);
          } else {
            head = range.anchor;
            anchor = maxPos(oldRange.to(), range.head);
          }
        }
        var ranges = startSel.ranges.slice(0);
        ranges[ourIndex] = new Range(clipPos(doc, anchor), head);
        setSelection(doc, normalizeSelection(ranges, ourIndex), sel_mouse);
      }
    }

    var editorSize = display.wrapper.getBoundingClientRect();
    // Used to ensure timeout re-tries don't fire when another extend
    // happened in the meantime (clearTimeout isn't reliable -- at
    // least on Chrome, the timeouts still happen even when cleared,
    // if the clear happens after their scheduled firing time).
    var counter = 0;

    function extend(e) {
      var curCount = ++counter;
      var cur = posFromMouse(cm, e, true, type == "rect");
      if (!cur) return;
      if (cmp(cur, lastPos) != 0) {
        cm.curOp.focus = activeElt();
        extendTo(cur);
        var visible = visibleLines(display, doc);
        if (cur.line >= visible.to || cur.line < visible.from)
          setTimeout(operation(cm, function(){if (counter == curCount) extend(e);}), 150);
      } else {
        var outside = e.clientY < editorSize.top ? -20 : e.clientY > editorSize.bottom ? 20 : 0;
        if (outside) setTimeout(operation(cm, function() {
          if (counter != curCount) return;
          display.scroller.scrollTop += outside;
          extend(e);
        }), 50);
      }
    }

    function done(e) {
      cm.state.selectingText = false;
      counter = Infinity;
      e_preventDefault(e);
      display.input.focus();
      off(document, "mousemove", move);
      off(document, "mouseup", up);
      doc.history.lastSelOrigin = null;
    }

    var move = operation(cm, function(e) {
      if (!e_button(e)) done(e);
      else extend(e);
    });
    var up = operation(cm, done);
    cm.state.selectingText = up;
    on(document, "mousemove", move);
    on(document, "mouseup", up);
  }

  // Determines whether an event happened in the gutter, and fires the
  // handlers for the corresponding event.
  function gutterEvent(cm, e, type, prevent, signalfn) {
    try { var mX = e.clientX, mY = e.clientY; }
    catch(e) { return false; }
    if (mX >= Math.floor(cm.display.gutters.getBoundingClientRect().right)) return false;
    if (prevent) e_preventDefault(e);

    var display = cm.display;
    var lineBox = display.lineDiv.getBoundingClientRect();

    if (mY > lineBox.bottom || !hasHandler(cm, type)) return e_defaultPrevented(e);
    mY -= lineBox.top - display.viewOffset;

    for (var i = 0; i < cm.options.gutters.length; ++i) {
      var g = display.gutters.childNodes[i];
      if (g && g.getBoundingClientRect().right >= mX) {
        var line = lineAtHeight(cm.doc, mY);
        var gutter = cm.options.gutters[i];
        signalfn(cm, type, cm, line, gutter, e);
        return e_defaultPrevented(e);
      }
    }
  }

  function clickInGutter(cm, e) {
    return gutterEvent(cm, e, "gutterClick", true, signalLater);
  }

  // Kludge to work around strange IE behavior where it'll sometimes
  // re-fire a series of drag-related events right after the drop (#1551)
  var lastDrop = 0;

  function onDrop(e) {
    var cm = this;
    clearDragCursor(cm);
    if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e))
      return;
    e_preventDefault(e);
    if (ie) lastDrop = +new Date;
    var pos = posFromMouse(cm, e, true), files = e.dataTransfer.files;
    if (!pos || isReadOnly(cm)) return;
    // Might be a file drop, in which case we simply extract the text
    // and insert it.
    if (files && files.length && window.FileReader && window.File) {
      var n = files.length, text = Array(n), read = 0;
      var loadFile = function(file, i) {
        if (cm.options.allowDropFileTypes &&
            indexOf(cm.options.allowDropFileTypes, file.type) == -1)
          return;

        var reader = new FileReader;
        reader.onload = operation(cm, function() {
          var content = reader.result;
          if (/[\x00-\x08\x0e-\x1f]{2}/.test(content)) content = "";
          text[i] = content;
          if (++read == n) {
            pos = clipPos(cm.doc, pos);
            var change = {from: pos, to: pos,
                          text: cm.doc.splitLines(text.join(cm.doc.lineSeparator())),
                          origin: "paste"};
            makeChange(cm.doc, change);
            setSelectionReplaceHistory(cm.doc, simpleSelection(pos, changeEnd(change)));
          }
        });
        reader.readAsText(file);
      };
      for (var i = 0; i < n; ++i) loadFile(files[i], i);
    } else { // Normal drop
      // Don't do a replace if the drop happened inside of the selected text.
      if (cm.state.draggingText && cm.doc.sel.contains(pos) > -1) {
        cm.state.draggingText(e);
        // Ensure the editor is re-focused
        setTimeout(function() {cm.display.input.focus();}, 20);
        return;
      }
      try {
        var text = e.dataTransfer.getData("Text");
        if (text) {
          if (cm.state.draggingText && !(mac ? e.altKey : e.ctrlKey))
            var selected = cm.listSelections();
          setSelectionNoUndo(cm.doc, simpleSelection(pos, pos));
          if (selected) for (var i = 0; i < selected.length; ++i)
            replaceRange(cm.doc, "", selected[i].anchor, selected[i].head, "drag");
          cm.replaceSelection(text, "around", "paste");
          cm.display.input.focus();
        }
      }
      catch(e){}
    }
  }

  function onDragStart(cm, e) {
    if (ie && (!cm.state.draggingText || +new Date - lastDrop < 100)) { e_stop(e); return; }
    if (signalDOMEvent(cm, e) || eventInWidget(cm.display, e)) return;

    e.dataTransfer.setData("Text", cm.getSelection());

    // Use dummy image instead of default browsers image.
    // Recent Safari (~6.0.2) have a tendency to segfault when this happens, so we don't do it there.
    if (e.dataTransfer.setDragImage && !safari) {
      var img = elt("img", null, null, "position: fixed; left: 0; top: 0;");
      img.src = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
      if (presto) {
        img.width = img.height = 1;
        cm.display.wrapper.appendChild(img);
        // Force a relayout, or Opera won't use our image for some obscure reason
        img._top = img.offsetTop;
      }
      e.dataTransfer.setDragImage(img, 0, 0);
      if (presto) img.parentNode.removeChild(img);
    }
  }

  function onDragOver(cm, e) {
    var pos = posFromMouse(cm, e);
    if (!pos) return;
    var frag = document.createDocumentFragment();
    drawSelectionCursor(cm, pos, frag);
    if (!cm.display.dragCursor) {
      cm.display.dragCursor = elt("div", null, "CodeMirror-cursors CodeMirror-dragcursors");
      cm.display.lineSpace.insertBefore(cm.display.dragCursor, cm.display.cursorDiv);
    }
    removeChildrenAndAdd(cm.display.dragCursor, frag);
  }

  function clearDragCursor(cm) {
    if (cm.display.dragCursor) {
      cm.display.lineSpace.removeChild(cm.display.dragCursor);
      cm.display.dragCursor = null;
    }
  }

  // SCROLL EVENTS

  // Sync the scrollable area and scrollbars, ensure the viewport
  // covers the visible area.
  function setScrollTop(cm, val) {
    if (Math.abs(cm.doc.scrollTop - val) < 2) return;
    cm.doc.scrollTop = val;
    if (!gecko) updateDisplaySimple(cm, {top: val});
    if (cm.display.scroller.scrollTop != val) cm.display.scroller.scrollTop = val;
    cm.display.scrollbars.setScrollTop(val);
    if (gecko) updateDisplaySimple(cm);
    startWorker(cm, 100);
  }
  // Sync scroller and scrollbar, ensure the gutter elements are
  // aligned.
  function setScrollLeft(cm, val, isScroller) {
    if (isScroller ? val == cm.doc.scrollLeft : Math.abs(cm.doc.scrollLeft - val) < 2) return;
    val = Math.min(val, cm.display.scroller.scrollWidth - cm.display.scroller.clientWidth);
    cm.doc.scrollLeft = val;
    alignHorizontally(cm);
    if (cm.display.scroller.scrollLeft != val) cm.display.scroller.scrollLeft = val;
    cm.display.scrollbars.setScrollLeft(val);
  }

  // Since the delta values reported on mouse wheel events are
  // unstandardized between browsers and even browser versions, and
  // generally horribly unpredictable, this code starts by measuring
  // the scroll effect that the first few mouse wheel events have,
  // and, from that, detects the way it can convert deltas to pixel
  // offsets afterwards.
  //
  // The reason we want to know the amount a wheel event will scroll
  // is that it gives us a chance to update the display before the
  // actual scrolling happens, reducing flickering.

  var wheelSamples = 0, wheelPixelsPerUnit = null;
  // Fill in a browser-detected starting value on browsers where we
  // know one. These don't have to be accurate -- the result of them
  // being wrong would just be a slight flicker on the first wheel
  // scroll (if it is large enough).
  if (ie) wheelPixelsPerUnit = -.53;
  else if (gecko) wheelPixelsPerUnit = 15;
  else if (chrome) wheelPixelsPerUnit = -.7;
  else if (safari) wheelPixelsPerUnit = -1/3;

  var wheelEventDelta = function(e) {
    var dx = e.wheelDeltaX, dy = e.wheelDeltaY;
    if (dx == null && e.detail && e.axis == e.HORIZONTAL_AXIS) dx = e.detail;
    if (dy == null && e.detail && e.axis == e.VERTICAL_AXIS) dy = e.detail;
    else if (dy == null) dy = e.wheelDelta;
    return {x: dx, y: dy};
  };
  CodeMirror.wheelEventPixels = function(e) {
    var delta = wheelEventDelta(e);
    delta.x *= wheelPixelsPerUnit;
    delta.y *= wheelPixelsPerUnit;
    return delta;
  };

  function onScrollWheel(cm, e) {
    var delta = wheelEventDelta(e), dx = delta.x, dy = delta.y;

    var display = cm.display, scroll = display.scroller;
    // Quit if there's nothing to scroll here
    var canScrollX = scroll.scrollWidth > scroll.clientWidth;
    var canScrollY = scroll.scrollHeight > scroll.clientHeight;
    if (!(dx && canScrollX || dy && canScrollY)) return;

    // Webkit browsers on OS X abort momentum scrolls when the target
    // of the scroll event is removed from the scrollable element.
    // This hack (see related code in patchDisplay) makes sure the
    // element is kept around.
    if (dy && mac && webkit) {
      outer: for (var cur = e.target, view = display.view; cur != scroll; cur = cur.parentNode) {
        for (var i = 0; i < view.length; i++) {
          if (view[i].node == cur) {
            cm.display.currentWheelTarget = cur;
            break outer;
          }
        }
      }
    }

    // On some browsers, horizontal scrolling will cause redraws to
    // happen before the gutter has been realigned, causing it to
    // wriggle around in a most unseemly way. When we have an
    // estimated pixels/delta value, we just handle horizontal
    // scrolling entirely here. It'll be slightly off from native, but
    // better than glitching out.
    if (dx && !gecko && !presto && wheelPixelsPerUnit != null) {
      if (dy && canScrollY)
        setScrollTop(cm, Math.max(0, Math.min(scroll.scrollTop + dy * wheelPixelsPerUnit, scroll.scrollHeight - scroll.clientHeight)));
      setScrollLeft(cm, Math.max(0, Math.min(scroll.scrollLeft + dx * wheelPixelsPerUnit, scroll.scrollWidth - scroll.clientWidth)));
      // Only prevent default scrolling if vertical scrolling is
      // actually possible. Otherwise, it causes vertical scroll
      // jitter on OSX trackpads when deltaX is small and deltaY
      // is large (issue #3579)
      if (!dy || (dy && canScrollY))
        e_preventDefault(e);
      display.wheelStartX = null; // Abort measurement, if in progress
      return;
    }

    // 'Project' the visible viewport to cover the area that is being
    // scrolled into view (if we know enough to estimate it).
    if (dy && wheelPixelsPerUnit != null) {
      var pixels = dy * wheelPixelsPerUnit;
      var top = cm.doc.scrollTop, bot = top + display.wrapper.clientHeight;
      if (pixels < 0) top = Math.max(0, top + pixels - 50);
      else bot = Math.min(cm.doc.height, bot + pixels + 50);
      updateDisplaySimple(cm, {top: top, bottom: bot});
    }

    if (wheelSamples < 20) {
      if (display.wheelStartX == null) {
        display.wheelStartX = scroll.scrollLeft; display.wheelStartY = scroll.scrollTop;
        display.wheelDX = dx; display.wheelDY = dy;
        setTimeout(function() {
          if (display.wheelStartX == null) return;
          var movedX = scroll.scrollLeft - display.wheelStartX;
          var movedY = scroll.scrollTop - display.wheelStartY;
          var sample = (movedY && display.wheelDY && movedY / display.wheelDY) ||
            (movedX && display.wheelDX && movedX / display.wheelDX);
          display.wheelStartX = display.wheelStartY = null;
          if (!sample) return;
          wheelPixelsPerUnit = (wheelPixelsPerUnit * wheelSamples + sample) / (wheelSamples + 1);
          ++wheelSamples;
        }, 200);
      } else {
        display.wheelDX += dx; display.wheelDY += dy;
      }
    }
  }

  // KEY EVENTS

  // Run a handler that was bound to a key.
  function doHandleBinding(cm, bound, dropShift) {
    if (typeof bound == "string") {
      bound = commands[bound];
      if (!bound) return false;
    }
    // Ensure previous input has been read, so that the handler sees a
    // consistent view of the document
    cm.display.input.ensurePolled();
    var prevShift = cm.display.shift, done = false;
    try {
      if (isReadOnly(cm)) cm.state.suppressEdits = true;
      if (dropShift) cm.display.shift = false;
      done = bound(cm) != Pass;
    } finally {
      cm.display.shift = prevShift;
      cm.state.suppressEdits = false;
    }
    return done;
  }

  function lookupKeyForEditor(cm, name, handle) {
    for (var i = 0; i < cm.state.keyMaps.length; i++) {
      var result = lookupKey(name, cm.state.keyMaps[i], handle, cm);
      if (result) return result;
    }
    return (cm.options.extraKeys && lookupKey(name, cm.options.extraKeys, handle, cm))
      || lookupKey(name, cm.options.keyMap, handle, cm);
  }

  var stopSeq = new Delayed;
  function dispatchKey(cm, name, e, handle) {
    var seq = cm.state.keySeq;
    if (seq) {
      if (isModifierKey(name)) return "handled";
      stopSeq.set(50, function() {
        if (cm.state.keySeq == seq) {
          cm.state.keySeq = null;
          cm.display.input.reset();
        }
      });
      name = seq + " " + name;
    }
    var result = lookupKeyForEditor(cm, name, handle);

    if (result == "multi")
      cm.state.keySeq = name;
    if (result == "handled")
      signalLater(cm, "keyHandled", cm, name, e);

    if (result == "handled" || result == "multi") {
      e_preventDefault(e);
      restartBlink(cm);
    }

    if (seq && !result && /\'$/.test(name)) {
      e_preventDefault(e);
      return true;
    }
    return !!result;
  }

  // Handle a key from the keydown event.
  function handleKeyBinding(cm, e) {
    var name = keyName(e, true);
    if (!name) return false;

    if (e.shiftKey && !cm.state.keySeq) {
      // First try to resolve full name (including 'Shift-'). Failing
      // that, see if there is a cursor-motion command (starting with
      // 'go') bound to the keyname without 'Shift-'.
      return dispatchKey(cm, "Shift-" + name, e, function(b) {return doHandleBinding(cm, b, true);})
          || dispatchKey(cm, name, e, function(b) {
               if (typeof b == "string" ? /^go[A-Z]/.test(b) : b.motion)
                 return doHandleBinding(cm, b);
             });
    } else {
      return dispatchKey(cm, name, e, function(b) { return doHandleBinding(cm, b); });
    }
  }

  // Handle a key from the keypress event
  function handleCharBinding(cm, e, ch) {
    return dispatchKey(cm, "'" + ch + "'", e,
                       function(b) { return doHandleBinding(cm, b, true); });
  }

  var lastStoppedKey = null;
  function onKeyDown(e) {
    var cm = this;
    cm.curOp.focus = activeElt();
    if (signalDOMEvent(cm, e)) return;
    // IE does strange things with escape.
    if (ie && ie_version < 11 && e.keyCode == 27) e.returnValue = false;
    var code = e.keyCode;
    cm.display.shift = code == 16 || e.shiftKey;
    var handled = handleKeyBinding(cm, e);
    if (presto) {
      lastStoppedKey = handled ? code : null;
      // Opera has no cut event... we try to at least catch the key combo
      if (!handled && code == 88 && !hasCopyEvent && (mac ? e.metaKey : e.ctrlKey))
        cm.replaceSelection("", null, "cut");
    }

    // Turn mouse into crosshair when Alt is held on Mac.
    if (code == 18 && !/\bCodeMirror-crosshair\b/.test(cm.display.lineDiv.className))
      showCrossHair(cm);
  }

  function showCrossHair(cm) {
    var lineDiv = cm.display.lineDiv;
    addClass(lineDiv, "CodeMirror-crosshair");

    function up(e) {
      if (e.keyCode == 18 || !e.altKey) {
        rmClass(lineDiv, "CodeMirror-crosshair");
        off(document, "keyup", up);
        off(document, "mouseover", up);
      }
    }
    on(document, "keyup", up);
    on(document, "mouseover", up);
  }

  function onKeyUp(e) {
    if (e.keyCode == 16) this.doc.sel.shift = false;
    signalDOMEvent(this, e);
  }

  function onKeyPress(e) {
    var cm = this;
    if (eventInWidget(cm.display, e) || signalDOMEvent(cm, e) || e.ctrlKey && !e.altKey || mac && e.metaKey) return;
    var keyCode = e.keyCode, charCode = e.charCode;
    if (presto && keyCode == lastStoppedKey) {lastStoppedKey = null; e_preventDefault(e); return;}
    if ((presto && (!e.which || e.which < 10)) && handleKeyBinding(cm, e)) return;
    var ch = String.fromCharCode(charCode == null ? keyCode : charCode);
    if (handleCharBinding(cm, e, ch)) return;
    cm.display.input.onKeyPress(e);
  }

  // FOCUS/BLUR EVENTS

  function delayBlurEvent(cm) {
    cm.state.delayingBlurEvent = true;
    setTimeout(function() {
      if (cm.state.delayingBlurEvent) {
        cm.state.delayingBlurEvent = false;
        onBlur(cm);
      }
    }, 100);
  }

  function onFocus(cm) {
    if (cm.state.delayingBlurEvent) cm.state.delayingBlurEvent = false;

    if (cm.options.readOnly == "nocursor") return;
    if (!cm.state.focused) {
      signal(cm, "focus", cm);
      cm.state.focused = true;
      addClass(cm.display.wrapper, "CodeMirror-focused");
      // This test prevents this from firing when a context
      // menu is closed (since the input reset would kill the
      // select-all detection hack)
      if (!cm.curOp && cm.display.selForContextMenu != cm.doc.sel) {
        cm.display.input.reset();
        if (webkit) setTimeout(function() { cm.display.input.reset(true); }, 20); // Issue #1730
      }
      cm.display.input.receivedFocus();
    }
    restartBlink(cm);
  }
  function onBlur(cm) {
    if (cm.state.delayingBlurEvent) return;

    if (cm.state.focused) {
      signal(cm, "blur", cm);
      cm.state.focused = false;
      rmClass(cm.display.wrapper, "CodeMirror-focused");
    }
    clearInterval(cm.display.blinker);
    setTimeout(function() {if (!cm.state.focused) cm.display.shift = false;}, 150);
  }

  // CONTEXT MENU HANDLING

  // To make the context menu work, we need to briefly unhide the
  // textarea (making it as unobtrusive as possible) to let the
  // right-click take effect on it.
  function onContextMenu(cm, e) {
    if (eventInWidget(cm.display, e) || contextMenuInGutter(cm, e)) return;
    if (signalDOMEvent(cm, e, "contextmenu")) return;
    cm.display.input.onContextMenu(e);
  }

  function contextMenuInGutter(cm, e) {
    if (!hasHandler(cm, "gutterContextMenu")) return false;
    return gutterEvent(cm, e, "gutterContextMenu", false, signal);
  }

  // UPDATING

  // Compute the position of the end of a change (its 'to' property
  // refers to the pre-change end).
  var changeEnd = CodeMirror.changeEnd = function(change) {
    if (!change.text) return change.to;
    return Pos(change.from.line + change.text.length - 1,
               lst(change.text).length + (change.text.length == 1 ? change.from.ch : 0));
  };

  // Adjust a position to refer to the post-change position of the
  // same text, or the end of the change if the change covers it.
  function adjustForChange(pos, change) {
    if (cmp(pos, change.from) < 0) return pos;
    if (cmp(pos, change.to) <= 0) return changeEnd(change);

    var line = pos.line + change.text.length - (change.to.line - change.from.line) - 1, ch = pos.ch;
    if (pos.line == change.to.line) ch += changeEnd(change).ch - change.to.ch;
    return Pos(line, ch);
  }

  function computeSelAfterChange(doc, change) {
    var out = [];
    for (var i = 0; i < doc.sel.ranges.length; i++) {
      var range = doc.sel.ranges[i];
      out.push(new Range(adjustForChange(range.anchor, change),
                         adjustForChange(range.head, change)));
    }
    return normalizeSelection(out, doc.sel.primIndex);
  }

  function offsetPos(pos, old, nw) {
    if (pos.line == old.line)
      return Pos(nw.line, pos.ch - old.ch + nw.ch);
    else
      return Pos(nw.line + (pos.line - old.line), pos.ch);
  }

  // Used by replaceSelections to allow moving the selection to the
  // start or around the replaced test. Hint may be "start" or "around".
  function computeReplacedSel(doc, changes, hint) {
    var out = [];
    var oldPrev = Pos(doc.first, 0), newPrev = oldPrev;
    for (var i = 0; i < changes.length; i++) {
      var change = changes[i];
      var from = offsetPos(change.from, oldPrev, newPrev);
      var to = offsetPos(changeEnd(change), oldPrev, newPrev);
      oldPrev = change.to;
      newPrev = to;
      if (hint == "around") {
        var range = doc.sel.ranges[i], inv = cmp(range.head, range.anchor) < 0;
        out[i] = new Range(inv ? to : from, inv ? from : to);
      } else {
        out[i] = new Range(from, from);
      }
    }
    return new Selection(out, doc.sel.primIndex);
  }

  // Allow "beforeChange" event handlers to influence a change
  function filterChange(doc, change, update) {
    var obj = {
      canceled: false,
      from: change.from,
      to: change.to,
      text: change.text,
      origin: change.origin,
      cancel: function() { this.canceled = true; }
    };
    if (update) obj.update = function(from, to, text, origin) {
      if (from) this.from = clipPos(doc, from);
      if (to) this.to = clipPos(doc, to);
      if (text) this.text = text;
      if (origin !== undefined) this.origin = origin;
    };
    signal(doc, "beforeChange", doc, obj);
    if (doc.cm) signal(doc.cm, "beforeChange", doc.cm, obj);

    if (obj.canceled) return null;
    return {from: obj.from, to: obj.to, text: obj.text, origin: obj.origin};
  }

  // Apply a change to a document, and add it to the document's
  // history, and propagating it to all linked documents.
  function makeChange(doc, change, ignoreReadOnly) {
    if (doc.cm) {
      if (!doc.cm.curOp) return operation(doc.cm, makeChange)(doc, change, ignoreReadOnly);
      if (doc.cm.state.suppressEdits) return;
    }

    if (hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange")) {
      change = filterChange(doc, change, true);
      if (!change) return;
    }

    // Possibly split or suppress the update based on the presence
    // of read-only spans in its range.
    var split = sawReadOnlySpans && !ignoreReadOnly && removeReadOnlyRanges(doc, change.from, change.to);
    if (split) {
      for (var i = split.length - 1; i >= 0; --i)
        makeChangeInner(doc, {from: split[i].from, to: split[i].to, text: i ? [""] : change.text});
    } else {
      makeChangeInner(doc, change);
    }
  }

  function makeChangeInner(doc, change) {
    if (change.text.length == 1 && change.text[0] == "" && cmp(change.from, change.to) == 0) return;
    var selAfter = computeSelAfterChange(doc, change);
    addChangeToHistory(doc, change, selAfter, doc.cm ? doc.cm.curOp.id : NaN);

    makeChangeSingleDoc(doc, change, selAfter, stretchSpansOverChange(doc, change));
    var rebased = [];

    linkedDocs(doc, function(doc, sharedHist) {
      if (!sharedHist && indexOf(rebased, doc.history) == -1) {
        rebaseHist(doc.history, change);
        rebased.push(doc.history);
      }
      makeChangeSingleDoc(doc, change, null, stretchSpansOverChange(doc, change));
    });
  }

  // Revert a change stored in a document's history.
  function makeChangeFromHistory(doc, type, allowSelectionOnly) {
    if (doc.cm && doc.cm.state.suppressEdits) return;

    var hist = doc.history, event, selAfter = doc.sel;
    var source = type == "undo" ? hist.done : hist.undone, dest = type == "undo" ? hist.undone : hist.done;

    // Verify that there is a useable event (so that ctrl-z won't
    // needlessly clear selection events)
    for (var i = 0; i < source.length; i++) {
      event = source[i];
      if (allowSelectionOnly ? event.ranges && !event.equals(doc.sel) : !event.ranges)
        break;
    }
    if (i == source.length) return;
    hist.lastOrigin = hist.lastSelOrigin = null;

    for (;;) {
      event = source.pop();
      if (event.ranges) {
        pushSelectionToHistory(event, dest);
        if (allowSelectionOnly && !event.equals(doc.sel)) {
          setSelection(doc, event, {clearRedo: false});
          return;
        }
        selAfter = event;
      }
      else break;
    }

    // Build up a reverse change object to add to the opposite history
    // stack (redo when undoing, and vice versa).
    var antiChanges = [];
    pushSelectionToHistory(selAfter, dest);
    dest.push({changes: antiChanges, generation: hist.generation});
    hist.generation = event.generation || ++hist.maxGeneration;

    var filter = hasHandler(doc, "beforeChange") || doc.cm && hasHandler(doc.cm, "beforeChange");

    for (var i = event.changes.length - 1; i >= 0; --i) {
      var change = event.changes[i];
      change.origin = type;
      if (filter && !filterChange(doc, change, false)) {
        source.length = 0;
        return;
      }

      antiChanges.push(historyChangeFromChange(doc, change));

      var after = i ? computeSelAfterChange(doc, change) : lst(source);
      makeChangeSingleDoc(doc, change, after, mergeOldSpans(doc, change));
      if (!i && doc.cm) doc.cm.scrollIntoView({from: change.from, to: changeEnd(change)});
      var rebased = [];

      // Propagate to the linked documents
      linkedDocs(doc, function(doc, sharedHist) {
        if (!sharedHist && indexOf(rebased, doc.history) == -1) {
          rebaseHist(doc.history, change);
          rebased.push(doc.history);
        }
        makeChangeSingleDoc(doc, change, null, mergeOldSpans(doc, change));
      });
    }
  }

  // Sub-views need their line numbers shifted when text is added
  // above or below them in the parent document.
  function shiftDoc(doc, distance) {
    if (distance == 0) return;
    doc.first += distance;
    doc.sel = new Selection(map(doc.sel.ranges, function(range) {
      return new Range(Pos(range.anchor.line + distance, range.anchor.ch),
                       Pos(range.head.line + distance, range.head.ch));
    }), doc.sel.primIndex);
    if (doc.cm) {
      regChange(doc.cm, doc.first, doc.first - distance, distance);
      for (var d = doc.cm.display, l = d.viewFrom; l < d.viewTo; l++)
        regLineChange(doc.cm, l, "gutter");
    }
  }

  // More lower-level change function, handling only a single document
  // (not linked ones).
  function makeChangeSingleDoc(doc, change, selAfter, spans) {
    if (doc.cm && !doc.cm.curOp)
      return operation(doc.cm, makeChangeSingleDoc)(doc, change, selAfter, spans);

    if (change.to.line < doc.first) {
      shiftDoc(doc, change.text.length - 1 - (change.to.line - change.from.line));
      return;
    }
    if (change.from.line > doc.lastLine()) return;

    // Clip the change to the size of this doc
    if (change.from.line < doc.first) {
      var shift = change.text.length - 1 - (doc.first - change.from.line);
      shiftDoc(doc, shift);
      change = {from: Pos(doc.first, 0), to: Pos(change.to.line + shift, change.to.ch),
                text: [lst(change.text)], origin: change.origin};
    }
    var last = doc.lastLine();
    if (change.to.line > last) {
      change = {from: change.from, to: Pos(last, getLine(doc, last).text.length),
                text: [change.text[0]], origin: change.origin};
    }

    change.removed = getBetween(doc, change.from, change.to);

    if (!selAfter) selAfter = computeSelAfterChange(doc, change);
    if (doc.cm) makeChangeSingleDocInEditor(doc.cm, change, spans);
    else updateDoc(doc, change, spans);
    setSelectionNoUndo(doc, selAfter, sel_dontScroll);
  }

  // Handle the interaction of a change to a document with the editor
  // that this document is part of.
  function makeChangeSingleDocInEditor(cm, change, spans) {
    var doc = cm.doc, display = cm.display, from = change.from, to = change.to;

    var recomputeMaxLength = false, checkWidthStart = from.line;
    if (!cm.options.lineWrapping) {
      checkWidthStart = lineNo(visualLine(getLine(doc, from.line)));
      doc.iter(checkWidthStart, to.line + 1, function(line) {
        if (line == display.maxLine) {
          recomputeMaxLength = true;
          return true;
        }
      });
    }

    if (doc.sel.contains(change.from, change.to) > -1)
      signalCursorActivity(cm);

    updateDoc(doc, change, spans, estimateHeight(cm));

    if (!cm.options.lineWrapping) {
      doc.iter(checkWidthStart, from.line + change.text.length, function(line) {
        var len = lineLength(line);
        if (len > display.maxLineLength) {
          display.maxLine = line;
          display.maxLineLength = len;
          display.maxLineChanged = true;
          recomputeMaxLength = false;
        }
      });
      if (recomputeMaxLength) cm.curOp.updateMaxLine = true;
    }

    // Adjust frontier, schedule worker
    doc.frontier = Math.min(doc.frontier, from.line);
    startWorker(cm, 400);

    var lendiff = change.text.length - (to.line - from.line) - 1;
    // Remember that these lines changed, for updating the display
    if (change.full)
      regChange(cm);
    else if (from.line == to.line && change.text.length == 1 && !isWholeLineUpdate(cm.doc, change))
      regLineChange(cm, from.line, "text");
    else
      regChange(cm, from.line, to.line + 1, lendiff);

    var changesHandler = hasHandler(cm, "changes"), changeHandler = hasHandler(cm, "change");
    if (changeHandler || changesHandler) {
      var obj = {
        from: from, to: to,
        text: change.text,
        removed: change.removed,
        origin: change.origin
      };
      if (changeHandler) signalLater(cm, "change", cm, obj);
      if (changesHandler) (cm.curOp.changeObjs || (cm.curOp.changeObjs = [])).push(obj);
    }
    cm.display.selForContextMenu = null;
  }

  function replaceRange(doc, code, from, to, origin) {
    if (!to) to = from;
    if (cmp(to, from) < 0) { var tmp = to; to = from; from = tmp; }
    if (typeof code == "string") code = doc.splitLines(code);
    makeChange(doc, {from: from, to: to, text: code, origin: origin});
  }

  // SCROLLING THINGS INTO VIEW

  // If an editor sits on the top or bottom of the window, partially
  // scrolled out of view, this ensures that the cursor is visible.
  function maybeScrollWindow(cm, coords) {
    if (signalDOMEvent(cm, "scrollCursorIntoView")) return;

    var display = cm.display, box = display.sizer.getBoundingClientRect(), doScroll = null;
    if (coords.top + box.top < 0) doScroll = true;
    else if (coords.bottom + box.top > (window.innerHeight || document.documentElement.clientHeight)) doScroll = false;
    if (doScroll != null && !phantom) {
      var scrollNode = elt("div", "\u200b", null, "position: absolute; top: " +
                           (coords.top - display.viewOffset - paddingTop(cm.display)) + "px; height: " +
                           (coords.bottom - coords.top + scrollGap(cm) + display.barHeight) + "px; left: " +
                           coords.left + "px; width: 2px;");
      cm.display.lineSpace.appendChild(scrollNode);
      scrollNode.scrollIntoView(doScroll);
      cm.display.lineSpace.removeChild(scrollNode);
    }
  }

  // Scroll a given position into view (immediately), verifying that
  // it actually became visible (as line heights are accurately
  // measured, the position of something may 'drift' during drawing).
  function scrollPosIntoView(cm, pos, end, margin) {
    if (margin == null) margin = 0;
    for (var limit = 0; limit < 5; limit++) {
      var changed = false, coords = cursorCoords(cm, pos);
      var endCoords = !end || end == pos ? coords : cursorCoords(cm, end);
      var scrollPos = calculateScrollPos(cm, Math.min(coords.left, endCoords.left),
                                         Math.min(coords.top, endCoords.top) - margin,
                                         Math.max(coords.left, endCoords.left),
                                         Math.max(coords.bottom, endCoords.bottom) + margin);
      var startTop = cm.doc.scrollTop, startLeft = cm.doc.scrollLeft;
      if (scrollPos.scrollTop != null) {
        setScrollTop(cm, scrollPos.scrollTop);
        if (Math.abs(cm.doc.scrollTop - startTop) > 1) changed = true;
      }
      if (scrollPos.scrollLeft != null) {
        setScrollLeft(cm, scrollPos.scrollLeft);
        if (Math.abs(cm.doc.scrollLeft - startLeft) > 1) changed = true;
      }
      if (!changed) break;
    }
    return coords;
  }

  // Scroll a given set of coordinates into view (immediately).
  function scrollIntoView(cm, x1, y1, x2, y2) {
    var scrollPos = calculateScrollPos(cm, x1, y1, x2, y2);
    if (scrollPos.scrollTop != null) setScrollTop(cm, scrollPos.scrollTop);
    if (scrollPos.scrollLeft != null) setScrollLeft(cm, scrollPos.scrollLeft);
  }

  // Calculate a new scroll position needed to scroll the given
  // rectangle into view. Returns an object with scrollTop and
  // scrollLeft properties. When these are undefined, the
  // vertical/horizontal position does not need to be adjusted.
  function calculateScrollPos(cm, x1, y1, x2, y2) {
    var display = cm.display, snapMargin = textHeight(cm.display);
    if (y1 < 0) y1 = 0;
    var screentop = cm.curOp && cm.curOp.scrollTop != null ? cm.curOp.scrollTop : display.scroller.scrollTop;
    var screen = displayHeight(cm), result = {};
    if (y2 - y1 > screen) y2 = y1 + screen;
    var docBottom = cm.doc.height + paddingVert(display);
    var atTop = y1 < snapMargin, atBottom = y2 > docBottom - snapMargin;
    if (y1 < screentop) {
      result.scrollTop = atTop ? 0 : y1;
    } else if (y2 > screentop + screen) {
      var newTop = Math.min(y1, (atBottom ? docBottom : y2) - screen);
      if (newTop != screentop) result.scrollTop = newTop;
    }

    var screenleft = cm.curOp && cm.curOp.scrollLeft != null ? cm.curOp.scrollLeft : display.scroller.scrollLeft;
    var screenw = displayWidth(cm) - (cm.options.fixedGutter ? display.gutters.offsetWidth : 0);
    var tooWide = x2 - x1 > screenw;
    if (tooWide) x2 = x1 + screenw;
    if (x1 < 10)
      result.scrollLeft = 0;
    else if (x1 < screenleft)
      result.scrollLeft = Math.max(0, x1 - (tooWide ? 0 : 10));
    else if (x2 > screenw + screenleft - 3)
      result.scrollLeft = x2 + (tooWide ? 0 : 10) - screenw;
    return result;
  }

  // Store a relative adjustment to the scroll position in the current
  // operation (to be applied when the operation finishes).
  function addToScrollPos(cm, left, top) {
    if (left != null || top != null) resolveScrollToPos(cm);
    if (left != null)
      cm.curOp.scrollLeft = (cm.curOp.scrollLeft == null ? cm.doc.scrollLeft : cm.curOp.scrollLeft) + left;
    if (top != null)
      cm.curOp.scrollTop = (cm.curOp.scrollTop == null ? cm.doc.scrollTop : cm.curOp.scrollTop) + top;
  }

  // Make sure that at the end of the operation the current cursor is
  // shown.
  function ensureCursorVisible(cm) {
    resolveScrollToPos(cm);
    var cur = cm.getCursor(), from = cur, to = cur;
    if (!cm.options.lineWrapping) {
      from = cur.ch ? Pos(cur.line, cur.ch - 1) : cur;
      to = Pos(cur.line, cur.ch + 1);
    }
    cm.curOp.scrollToPos = {from: from, to: to, margin: cm.options.cursorScrollMargin, isCursor: true};
  }

  // When an operation has its scrollToPos property set, and another
  // scroll action is applied before the end of the operation, this
  // 'simulates' scrolling that position into view in a cheap way, so
  // that the effect of intermediate scroll commands is not ignored.
  function resolveScrollToPos(cm) {
    var range = cm.curOp.scrollToPos;
    if (range) {
      cm.curOp.scrollToPos = null;
      var from = estimateCoords(cm, range.from), to = estimateCoords(cm, range.to);
      var sPos = calculateScrollPos(cm, Math.min(from.left, to.left),
                                    Math.min(from.top, to.top) - range.margin,
                                    Math.max(from.right, to.right),
                                    Math.max(from.bottom, to.bottom) + range.margin);
      cm.scrollTo(sPos.scrollLeft, sPos.scrollTop);
    }
  }

  // API UTILITIES

  // Indent the given line. The how parameter can be "smart",
  // "add"/null, "subtract", or "prev". When aggressive is false
  // (typically set to true for forced single-line indents), empty
  // lines are not indented, and places where the mode returns Pass
  // are left alone.
  function indentLine(cm, n, how, aggressive) {
    var doc = cm.doc, state;
    if (how == null) how = "add";
    if (how == "smart") {
      // Fall back to "prev" when the mode doesn't have an indentation
      // method.
      if (!doc.mode.indent) how = "prev";
      else state = getStateBefore(cm, n);
    }

    var tabSize = cm.options.tabSize;
    var line = getLine(doc, n), curSpace = countColumn(line.text, null, tabSize);
    if (line.stateAfter) line.stateAfter = null;
    var curSpaceString = line.text.match(/^\s*/)[0], indentation;
    if (!aggressive && !/\S/.test(line.text)) {
      indentation = 0;
      how = "not";
    } else if (how == "smart") {
      indentation = doc.mode.indent(state, line.text.slice(curSpaceString.length), line.text);
      if (indentation == Pass || indentation > 150) {
        if (!aggressive) return;
        how = "prev";
      }
    }
    if (how == "prev") {
      if (n > doc.first) indentation = countColumn(getLine(doc, n-1).text, null, tabSize);
      else indentation = 0;
    } else if (how == "add") {
      indentation = curSpace + cm.options.indentUnit;
    } else if (how == "subtract") {
      indentation = curSpace - cm.options.indentUnit;
    } else if (typeof how == "number") {
      indentation = curSpace + how;
    }
    indentation = Math.max(0, indentation);

    var indentString = "", pos = 0;
    if (cm.options.indentWithTabs)
      for (var i = Math.floor(indentation / tabSize); i; --i) {pos += tabSize; indentString += "\t";}
    if (pos < indentation) indentString += spaceStr(indentation - pos);

    if (indentString != curSpaceString) {
      replaceRange(doc, indentString, Pos(n, 0), Pos(n, curSpaceString.length), "+input");
      line.stateAfter = null;
      return true;
    } else {
      // Ensure that, if the cursor was in the whitespace at the start
      // of the line, it is moved to the end of that space.
      for (var i = 0; i < doc.sel.ranges.length; i++) {
        var range = doc.sel.ranges[i];
        if (range.head.line == n && range.head.ch < curSpaceString.length) {
          var pos = Pos(n, curSpaceString.length);
          replaceOneSelection(doc, i, new Range(pos, pos));
          break;
        }
      }
    }
  }

  // Utility for applying a change to a line by handle or number,
  // returning the number and optionally registering the line as
  // changed.
  function changeLine(doc, handle, changeType, op) {
    var no = handle, line = handle;
    if (typeof handle == "number") line = getLine(doc, clipLine(doc, handle));
    else no = lineNo(handle);
    if (no == null) return null;
    if (op(line, no) && doc.cm) regLineChange(doc.cm, no, changeType);
    return line;
  }

  // Helper for deleting text near the selection(s), used to implement
  // backspace, delete, and similar functionality.
  function deleteNearSelection(cm, compute) {
    var ranges = cm.doc.sel.ranges, kill = [];
    // Build up a set of ranges to kill first, merging overlapping
    // ranges.
    for (var i = 0; i < ranges.length; i++) {
      var toKill = compute(ranges[i]);
      while (kill.length && cmp(toKill.from, lst(kill).to) <= 0) {
        var replaced = kill.pop();
        if (cmp(replaced.from, toKill.from) < 0) {
          toKill.from = replaced.from;
          break;
        }
      }
      kill.push(toKill);
    }
    // Next, remove those actual ranges.
    runInOp(cm, function() {
      for (var i = kill.length - 1; i >= 0; i--)
        replaceRange(cm.doc, "", kill[i].from, kill[i].to, "+delete");
      ensureCursorVisible(cm);
    });
  }

  // Used for horizontal relative motion. Dir is -1 or 1 (left or
  // right), unit can be "char", "column" (like char, but doesn't
  // cross line boundaries), "word" (across next word), or "group" (to
  // the start of next group of word or non-word-non-whitespace
  // chars). The visually param controls whether, in right-to-left
  // text, direction 1 means to move towards the next index in the
  // string, or towards the character to the right of the current
  // position. The resulting position will have a hitSide=true
  // property if it reached the end of the document.
  function findPosH(doc, pos, dir, unit, visually) {
    var line = pos.line, ch = pos.ch, origDir = dir;
    var lineObj = getLine(doc, line);
    var possible = true;
    function findNextLine() {
      var l = line + dir;
      if (l < doc.first || l >= doc.first + doc.size) return (possible = false);
      line = l;
      return lineObj = getLine(doc, l);
    }
    function moveOnce(boundToLine) {
      var next = (visually ? moveVisually : moveLogically)(lineObj, ch, dir, true);
      if (next == null) {
        if (!boundToLine && findNextLine()) {
          if (visually) ch = (dir < 0 ? lineRight : lineLeft)(lineObj);
          else ch = dir < 0 ? lineObj.text.length : 0;
        } else return (possible = false);
      } else ch = next;
      return true;
    }

    if (unit == "char") moveOnce();
    else if (unit == "column") moveOnce(true);
    else if (unit == "word" || unit == "group") {
      var sawType = null, group = unit == "group";
      var helper = doc.cm && doc.cm.getHelper(pos, "wordChars");
      for (var first = true;; first = false) {
        if (dir < 0 && !moveOnce(!first)) break;
        var cur = lineObj.text.charAt(ch) || "\n";
        var type = isWordChar(cur, helper) ? "w"
          : group && cur == "\n" ? "n"
          : !group || /\s/.test(cur) ? null
          : "p";
        if (group && !first && !type) type = "s";
        if (sawType && sawType != type) {
          if (dir < 0) {dir = 1; moveOnce();}
          break;
        }

        if (type) sawType = type;
        if (dir > 0 && !moveOnce(!first)) break;
      }
    }
    var result = skipAtomic(doc, Pos(line, ch), origDir, true);
    if (!possible) result.hitSide = true;
    return result;
  }

  // For relative vertical movement. Dir may be -1 or 1. Unit can be
  // "page" or "line". The resulting position will have a hitSide=true
  // property if it reached the end of the document.
  function findPosV(cm, pos, dir, unit) {
    var doc = cm.doc, x = pos.left, y;
    if (unit == "page") {
      var pageSize = Math.min(cm.display.wrapper.clientHeight, window.innerHeight || document.documentElement.clientHeight);
      y = pos.top + dir * (pageSize - (dir < 0 ? 1.5 : .5) * textHeight(cm.display));
    } else if (unit == "line") {
      y = dir > 0 ? pos.bottom + 3 : pos.top - 3;
    }
    for (;;) {
      var target = coordsChar(cm, x, y);
      if (!target.outside) break;
      if (dir < 0 ? y <= 0 : y >= doc.height) { target.hitSide = true; break; }
      y += dir * 5;
    }
    return target;
  }

  // EDITOR METHODS

  // The publicly visible API. Note that methodOp(f) means
  // 'wrap f in an operation, performed on its `this` parameter'.

  // This is not the complete set of editor methods. Most of the
  // methods defined on the Doc type are also injected into
  // CodeMirror.prototype, for backwards compatibility and
  // convenience.

  CodeMirror.prototype = {
    constructor: CodeMirror,
    focus: function(){window.focus(); this.display.input.focus();},

    setOption: function(option, value) {
      var options = this.options, old = options[option];
      if (options[option] == value && option != "mode") return;
      options[option] = value;
      if (optionHandlers.hasOwnProperty(option))
        operation(this, optionHandlers[option])(this, value, old);
    },

    getOption: function(option) {return this.options[option];},
    getDoc: function() {return this.doc;},

    addKeyMap: function(map, bottom) {
      this.state.keyMaps[bottom ? "push" : "unshift"](getKeyMap(map));
    },
    removeKeyMap: function(map) {
      var maps = this.state.keyMaps;
      for (var i = 0; i < maps.length; ++i)
        if (maps[i] == map || maps[i].name == map) {
          maps.splice(i, 1);
          return true;
        }
    },

    addOverlay: methodOp(function(spec, options) {
      var mode = spec.token ? spec : CodeMirror.getMode(this.options, spec);
      if (mode.startState) throw new Error("Overlays may not be stateful.");
      this.state.overlays.push({mode: mode, modeSpec: spec, opaque: options && options.opaque});
      this.state.modeGen++;
      regChange(this);
    }),
    removeOverlay: methodOp(function(spec) {
      var overlays = this.state.overlays;
      for (var i = 0; i < overlays.length; ++i) {
        var cur = overlays[i].modeSpec;
        if (cur == spec || typeof spec == "string" && cur.name == spec) {
          overlays.splice(i, 1);
          this.state.modeGen++;
          regChange(this);
          return;
        }
      }
    }),

    indentLine: methodOp(function(n, dir, aggressive) {
      if (typeof dir != "string" && typeof dir != "number") {
        if (dir == null) dir = this.options.smartIndent ? "smart" : "prev";
        else dir = dir ? "add" : "subtract";
      }
      if (isLine(this.doc, n)) indentLine(this, n, dir, aggressive);
    }),
    indentSelection: methodOp(function(how) {
      var ranges = this.doc.sel.ranges, end = -1;
      for (var i = 0; i < ranges.length; i++) {
        var range = ranges[i];
        if (!range.empty()) {
          var from = range.from(), to = range.to();
          var start = Math.max(end, from.line);
          end = Math.min(this.lastLine(), to.line - (to.ch ? 0 : 1)) + 1;
          for (var j = start; j < end; ++j)
            indentLine(this, j, how);
          var newRanges = this.doc.sel.ranges;
          if (from.ch == 0 && ranges.length == newRanges.length && newRanges[i].from().ch > 0)
            replaceOneSelection(this.doc, i, new Range(from, newRanges[i].to()), sel_dontScroll);
        } else if (range.head.line > end) {
          indentLine(this, range.head.line, how, true);
          end = range.head.line;
          if (i == this.doc.sel.primIndex) ensureCursorVisible(this);
        }
      }
    }),

    // Fetch the parser token for a given character. Useful for hacks
    // that want to inspect the mode state (say, for completion).
    getTokenAt: function(pos, precise) {
      return takeToken(this, pos, precise);
    },

    getLineTokens: function(line, precise) {
      return takeToken(this, Pos(line), precise, true);
    },

    getTokenTypeAt: function(pos) {
      pos = clipPos(this.doc, pos);
      var styles = getLineStyles(this, getLine(this.doc, pos.line));
      var before = 0, after = (styles.length - 1) / 2, ch = pos.ch;
      var type;
      if (ch == 0) type = styles[2];
      else for (;;) {
        var mid = (before + after) >> 1;
        if ((mid ? styles[mid * 2 - 1] : 0) >= ch) after = mid;
        else if (styles[mid * 2 + 1] < ch) before = mid + 1;
        else { type = styles[mid * 2 + 2]; break; }
      }
      var cut = type ? type.indexOf("cm-overlay ") : -1;
      return cut < 0 ? type : cut == 0 ? null : type.slice(0, cut - 1);
    },

    getModeAt: function(pos) {
      var mode = this.doc.mode;
      if (!mode.innerMode) return mode;
      return CodeMirror.innerMode(mode, this.getTokenAt(pos).state).mode;
    },

    getHelper: function(pos, type) {
      return this.getHelpers(pos, type)[0];
    },

    getHelpers: function(pos, type) {
      var found = [];
      if (!helpers.hasOwnProperty(type)) return found;
      var help = helpers[type], mode = this.getModeAt(pos);
      if (typeof mode[type] == "string") {
        if (help[mode[type]]) found.push(help[mode[type]]);
      } else if (mode[type]) {
        for (var i = 0; i < mode[type].length; i++) {
          var val = help[mode[type][i]];
          if (val) found.push(val);
        }
      } else if (mode.helperType && help[mode.helperType]) {
        found.push(help[mode.helperType]);
      } else if (help[mode.name]) {
        found.push(help[mode.name]);
      }
      for (var i = 0; i < help._global.length; i++) {
        var cur = help._global[i];
        if (cur.pred(mode, this) && indexOf(found, cur.val) == -1)
          found.push(cur.val);
      }
      return found;
    },

    getStateAfter: function(line, precise) {
      var doc = this.doc;
      line = clipLine(doc, line == null ? doc.first + doc.size - 1: line);
      return getStateBefore(this, line + 1, precise);
    },

    cursorCoords: function(start, mode) {
      var pos, range = this.doc.sel.primary();
      if (start == null) pos = range.head;
      else if (typeof start == "object") pos = clipPos(this.doc, start);
      else pos = start ? range.from() : range.to();
      return cursorCoords(this, pos, mode || "page");
    },

    charCoords: function(pos, mode) {
      return charCoords(this, clipPos(this.doc, pos), mode || "page");
    },

    coordsChar: function(coords, mode) {
      coords = fromCoordSystem(this, coords, mode || "page");
      return coordsChar(this, coords.left, coords.top);
    },

    lineAtHeight: function(height, mode) {
      height = fromCoordSystem(this, {top: height, left: 0}, mode || "page").top;
      return lineAtHeight(this.doc, height + this.display.viewOffset);
    },
    heightAtLine: function(line, mode) {
      var end = false, lineObj;
      if (typeof line == "number") {
        var last = this.doc.first + this.doc.size - 1;
        if (line < this.doc.first) line = this.doc.first;
        else if (line > last) { line = last; end = true; }
        lineObj = getLine(this.doc, line);
      } else {
        lineObj = line;
      }
      return intoCoordSystem(this, lineObj, {top: 0, left: 0}, mode || "page").top +
        (end ? this.doc.height - heightAtLine(lineObj) : 0);
    },

    defaultTextHeight: function() { return textHeight(this.display); },
    defaultCharWidth: function() { return charWidth(this.display); },

    setGutterMarker: methodOp(function(line, gutterID, value) {
      return changeLine(this.doc, line, "gutter", function(line) {
        var markers = line.gutterMarkers || (line.gutterMarkers = {});
        markers[gutterID] = value;
        if (!value && isEmpty(markers)) line.gutterMarkers = null;
        return true;
      });
    }),

    clearGutter: methodOp(function(gutterID) {
      var cm = this, doc = cm.doc, i = doc.first;
      doc.iter(function(line) {
        if (line.gutterMarkers && line.gutterMarkers[gutterID]) {
          line.gutterMarkers[gutterID] = null;
          regLineChange(cm, i, "gutter");
          if (isEmpty(line.gutterMarkers)) line.gutterMarkers = null;
        }
        ++i;
      });
    }),

    lineInfo: function(line) {
      if (typeof line == "number") {
        if (!isLine(this.doc, line)) return null;
        var n = line;
        line = getLine(this.doc, line);
        if (!line) return null;
      } else {
        var n = lineNo(line);
        if (n == null) return null;
      }
      return {line: n, handle: line, text: line.text, gutterMarkers: line.gutterMarkers,
              textClass: line.textClass, bgClass: line.bgClass, wrapClass: line.wrapClass,
              widgets: line.widgets};
    },

    getViewport: function() { return {from: this.display.viewFrom, to: this.display.viewTo};},

    addWidget: function(pos, node, scroll, vert, horiz) {
      var display = this.display;
      pos = cursorCoords(this, clipPos(this.doc, pos));
      var top = pos.bottom, left = pos.left;
      node.style.position = "absolute";
      node.setAttribute("cm-ignore-events", "true");
      this.display.input.setUneditable(node);
      display.sizer.appendChild(node);
      if (vert == "over") {
        top = pos.top;
      } else if (vert == "above" || vert == "near") {
        var vspace = Math.max(display.wrapper.clientHeight, this.doc.height),
        hspace = Math.max(display.sizer.clientWidth, display.lineSpace.clientWidth);
        // Default to positioning above (if specified and possible); otherwise default to positioning below
        if ((vert == 'above' || pos.bottom + node.offsetHeight > vspace) && pos.top > node.offsetHeight)
          top = pos.top - node.offsetHeight;
        else if (pos.bottom + node.offsetHeight <= vspace)
          top = pos.bottom;
        if (left + node.offsetWidth > hspace)
          left = hspace - node.offsetWidth;
      }
      node.style.top = top + "px";
      node.style.left = node.style.right = "";
      if (horiz == "right") {
        left = display.sizer.clientWidth - node.offsetWidth;
        node.style.right = "0px";
      } else {
        if (horiz == "left") left = 0;
        else if (horiz == "middle") left = (display.sizer.clientWidth - node.offsetWidth) / 2;
        node.style.left = left + "px";
      }
      if (scroll)
        scrollIntoView(this, left, top, left + node.offsetWidth, top + node.offsetHeight);
    },

    triggerOnKeyDown: methodOp(onKeyDown),
    triggerOnKeyPress: methodOp(onKeyPress),
    triggerOnKeyUp: onKeyUp,

    execCommand: function(cmd) {
      if (commands.hasOwnProperty(cmd))
        return commands[cmd].call(null, this);
    },

    triggerElectric: methodOp(function(text) { triggerElectric(this, text); }),

    findPosH: function(from, amount, unit, visually) {
      var dir = 1;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        cur = findPosH(this.doc, cur, dir, unit, visually);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveH: methodOp(function(dir, unit) {
      var cm = this;
      cm.extendSelectionsBy(function(range) {
        if (cm.display.shift || cm.doc.extend || range.empty())
          return findPosH(cm.doc, range.head, dir, unit, cm.options.rtlMoveVisually);
        else
          return dir < 0 ? range.from() : range.to();
      }, sel_move);
    }),

    deleteH: methodOp(function(dir, unit) {
      var sel = this.doc.sel, doc = this.doc;
      if (sel.somethingSelected())
        doc.replaceSelection("", null, "+delete");
      else
        deleteNearSelection(this, function(range) {
          var other = findPosH(doc, range.head, dir, unit, false);
          return dir < 0 ? {from: other, to: range.head} : {from: range.head, to: other};
        });
    }),

    findPosV: function(from, amount, unit, goalColumn) {
      var dir = 1, x = goalColumn;
      if (amount < 0) { dir = -1; amount = -amount; }
      for (var i = 0, cur = clipPos(this.doc, from); i < amount; ++i) {
        var coords = cursorCoords(this, cur, "div");
        if (x == null) x = coords.left;
        else coords.left = x;
        cur = findPosV(this, coords, dir, unit);
        if (cur.hitSide) break;
      }
      return cur;
    },

    moveV: methodOp(function(dir, unit) {
      var cm = this, doc = this.doc, goals = [];
      var collapse = !cm.display.shift && !doc.extend && doc.sel.somethingSelected();
      doc.extendSelectionsBy(function(range) {
        if (collapse)
          return dir < 0 ? range.from() : range.to();
        var headPos = cursorCoords(cm, range.head, "div");
        if (range.goalColumn != null) headPos.left = range.goalColumn;
        goals.push(headPos.left);
        var pos = findPosV(cm, headPos, dir, unit);
        if (unit == "page" && range == doc.sel.primary())
          addToScrollPos(cm, null, charCoords(cm, pos, "div").top - headPos.top);
        return pos;
      }, sel_move);
      if (goals.length) for (var i = 0; i < doc.sel.ranges.length; i++)
        doc.sel.ranges[i].goalColumn = goals[i];
    }),

    // Find the word at the given position (as returned by coordsChar).
    findWordAt: function(pos) {
      var doc = this.doc, line = getLine(doc, pos.line).text;
      var start = pos.ch, end = pos.ch;
      if (line) {
        var helper = this.getHelper(pos, "wordChars");
        if ((pos.xRel < 0 || end == line.length) && start) --start; else ++end;
        var startChar = line.charAt(start);
        var check = isWordChar(startChar, helper)
          ? function(ch) { return isWordChar(ch, helper); }
          : /\s/.test(startChar) ? function(ch) {return /\s/.test(ch);}
          : function(ch) {return !/\s/.test(ch) && !isWordChar(ch);};
        while (start > 0 && check(line.charAt(start - 1))) --start;
        while (end < line.length && check(line.charAt(end))) ++end;
      }
      return new Range(Pos(pos.line, start), Pos(pos.line, end));
    },

    toggleOverwrite: function(value) {
      if (value != null && value == this.state.overwrite) return;
      if (this.state.overwrite = !this.state.overwrite)
        addClass(this.display.cursorDiv, "CodeMirror-overwrite");
      else
        rmClass(this.display.cursorDiv, "CodeMirror-overwrite");

      signal(this, "overwriteToggle", this, this.state.overwrite);
    },
    hasFocus: function() { return this.display.input.getField() == activeElt(); },

    scrollTo: methodOp(function(x, y) {
      if (x != null || y != null) resolveScrollToPos(this);
      if (x != null) this.curOp.scrollLeft = x;
      if (y != null) this.curOp.scrollTop = y;
    }),
    getScrollInfo: function() {
      var scroller = this.display.scroller;
      return {left: scroller.scrollLeft, top: scroller.scrollTop,
              height: scroller.scrollHeight - scrollGap(this) - this.display.barHeight,
              width: scroller.scrollWidth - scrollGap(this) - this.display.barWidth,
              clientHeight: displayHeight(this), clientWidth: displayWidth(this)};
    },

    scrollIntoView: methodOp(function(range, margin) {
      if (range == null) {
        range = {from: this.doc.sel.primary().head, to: null};
        if (margin == null) margin = this.options.cursorScrollMargin;
      } else if (typeof range == "number") {
        range = {from: Pos(range, 0), to: null};
      } else if (range.from == null) {
        range = {from: range, to: null};
      }
      if (!range.to) range.to = range.from;
      range.margin = margin || 0;

      if (range.from.line != null) {
        resolveScrollToPos(this);
        this.curOp.scrollToPos = range;
      } else {
        var sPos = calculateScrollPos(this, Math.min(range.from.left, range.to.left),
                                      Math.min(range.from.top, range.to.top) - range.margin,
                                      Math.max(range.from.right, range.to.right),
                                      Math.max(range.from.bottom, range.to.bottom) + range.margin);
        this.scrollTo(sPos.scrollLeft, sPos.scrollTop);
      }
    }),

    setSize: methodOp(function(width, height) {
      var cm = this;
      function interpret(val) {
        return typeof val == "number" || /^\d+$/.test(String(val)) ? val + "px" : val;
      }
      if (width != null) cm.display.wrapper.style.width = interpret(width);
      if (height != null) cm.display.wrapper.style.height = interpret(height);
      if (cm.options.lineWrapping) clearLineMeasurementCache(this);
      var lineNo = cm.display.viewFrom;
      cm.doc.iter(lineNo, cm.display.viewTo, function(line) {
        if (line.widgets) for (var i = 0; i < line.widgets.length; i++)
          if (line.widgets[i].noHScroll) { regLineChange(cm, lineNo, "widget"); break; }
        ++lineNo;
      });
      cm.curOp.forceUpdate = true;
      signal(cm, "refresh", this);
    }),

    operation: function(f){return runInOp(this, f);},

    refresh: methodOp(function() {
      var oldHeight = this.display.cachedTextHeight;
      regChange(this);
      this.curOp.forceUpdate = true;
      clearCaches(this);
      this.scrollTo(this.doc.scrollLeft, this.doc.scrollTop);
      updateGutterSpace(this);
      if (oldHeight == null || Math.abs(oldHeight - textHeight(this.display)) > .5)
        estimateLineHeights(this);
      signal(this, "refresh", this);
    }),

    swapDoc: methodOp(function(doc) {
      var old = this.doc;
      old.cm = null;
      attachDoc(this, doc);
      clearCaches(this);
      this.display.input.reset();
      this.scrollTo(doc.scrollLeft, doc.scrollTop);
      this.curOp.forceScroll = true;
      signalLater(this, "swapDoc", this, old);
      return old;
    }),

    getInputField: function(){return this.display.input.getField();},
    getWrapperElement: function(){return this.display.wrapper;},
    getScrollerElement: function(){return this.display.scroller;},
    getGutterElement: function(){return this.display.gutters;}
  };
  eventMixin(CodeMirror);

  // OPTION DEFAULTS

  // The default configuration options.
  var defaults = CodeMirror.defaults = {};
  // Functions to run when options are changed.
  var optionHandlers = CodeMirror.optionHandlers = {};

  function option(name, deflt, handle, notOnInit) {
    CodeMirror.defaults[name] = deflt;
    if (handle) optionHandlers[name] =
      notOnInit ? function(cm, val, old) {if (old != Init) handle(cm, val, old);} : handle;
  }

  // Passed to option handlers when there is no old value.
  var Init = CodeMirror.Init = {toString: function(){return "CodeMirror.Init";}};

  // These two are, on init, called from the constructor because they
  // have to be initialized before the editor can start at all.
  option("value", "", function(cm, val) {
    cm.setValue(val);
  }, true);
  option("mode", null, function(cm, val) {
    cm.doc.modeOption = val;
    loadMode(cm);
  }, true);

  option("indentUnit", 2, loadMode, true);
  option("indentWithTabs", false);
  option("smartIndent", true);
  option("tabSize", 4, function(cm) {
    resetModeState(cm);
    clearCaches(cm);
    regChange(cm);
  }, true);
  option("lineSeparator", null, function(cm, val) {
    cm.doc.lineSep = val;
    if (!val) return;
    var newBreaks = [], lineNo = cm.doc.first;
    cm.doc.iter(function(line) {
      for (var pos = 0;;) {
        var found = line.text.indexOf(val, pos);
        if (found == -1) break;
        pos = found + val.length;
        newBreaks.push(Pos(lineNo, found));
      }
      lineNo++;
    });
    for (var i = newBreaks.length - 1; i >= 0; i--)
      replaceRange(cm.doc, val, newBreaks[i], Pos(newBreaks[i].line, newBreaks[i].ch + val.length))
  });
  option("specialChars", /[\t\u0000-\u0019\u00ad\u200b-\u200f\u2028\u2029\ufeff]/g, function(cm, val, old) {
    cm.state.specialChars = new RegExp(val.source + (val.test("\t") ? "" : "|\t"), "g");
    if (old != CodeMirror.Init) cm.refresh();
  });
  option("specialCharPlaceholder", defaultSpecialCharPlaceholder, function(cm) {cm.refresh();}, true);
  option("electricChars", true);
  option("inputStyle", mobile ? "contenteditable" : "textarea", function() {
    throw new Error("inputStyle can not (yet) be changed in a running editor"); // FIXME
  }, true);
  option("rtlMoveVisually", !windows);
  option("wholeLineUpdateBefore", true);

  option("theme", "default", function(cm) {
    themeChanged(cm);
    guttersChanged(cm);
  }, true);
  option("keyMap", "default", function(cm, val, old) {
    var next = getKeyMap(val);
    var prev = old != CodeMirror.Init && getKeyMap(old);
    if (prev && prev.detach) prev.detach(cm, next);
    if (next.attach) next.attach(cm, prev || null);
  });
  option("extraKeys", null);

  option("lineWrapping", false, wrappingChanged, true);
  option("gutters", [], function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("fixedGutter", true, function(cm, val) {
    cm.display.gutters.style.left = val ? compensateForHScroll(cm.display) + "px" : "0";
    cm.refresh();
  }, true);
  option("coverGutterNextToScrollbar", false, function(cm) {updateScrollbars(cm);}, true);
  option("scrollbarStyle", "native", function(cm) {
    initScrollbars(cm);
    updateScrollbars(cm);
    cm.display.scrollbars.setScrollTop(cm.doc.scrollTop);
    cm.display.scrollbars.setScrollLeft(cm.doc.scrollLeft);
  }, true);
  option("lineNumbers", false, function(cm) {
    setGuttersForLineNumbers(cm.options);
    guttersChanged(cm);
  }, true);
  option("firstLineNumber", 1, guttersChanged, true);
  option("lineNumberFormatter", function(integer) {return integer;}, guttersChanged, true);
  option("showCursorWhenSelecting", false, updateSelection, true);

  option("resetSelectionOnContextMenu", true);
  option("lineWiseCopyCut", true);

  option("readOnly", false, function(cm, val) {
    if (val == "nocursor") {
      onBlur(cm);
      cm.display.input.blur();
      cm.display.disabled = true;
    } else {
      cm.display.disabled = false;
    }
    cm.display.input.readOnlyChanged(val)
  });
  option("disableInput", false, function(cm, val) {if (!val) cm.display.input.reset();}, true);
  option("dragDrop", true, dragDropChanged);
  option("allowDropFileTypes", null);

  option("cursorBlinkRate", 530);
  option("cursorScrollMargin", 0);
  option("cursorHeight", 1, updateSelection, true);
  option("singleCursorHeightPerLine", true, updateSelection, true);
  option("workTime", 100);
  option("workDelay", 100);
  option("flattenSpans", true, resetModeState, true);
  option("addModeClass", false, resetModeState, true);
  option("pollInterval", 100);
  option("undoDepth", 200, function(cm, val){cm.doc.history.undoDepth = val;});
  option("historyEventDelay", 1250);
  option("viewportMargin", 10, function(cm){cm.refresh();}, true);
  option("maxHighlightLength", 10000, resetModeState, true);
  option("moveInputWithCursor", true, function(cm, val) {
    if (!val) cm.display.input.resetPosition();
  });

  option("tabindex", null, function(cm, val) {
    cm.display.input.getField().tabIndex = val || "";
  });
  option("autofocus", null);

  // MODE DEFINITION AND QUERYING

  // Known modes, by name and by MIME
  var modes = CodeMirror.modes = {}, mimeModes = CodeMirror.mimeModes = {};

  // Extra arguments are stored as the mode's dependencies, which is
  // used by (legacy) mechanisms like loadmode.js to automatically
  // load a mode. (Preferred mechanism is the require/define calls.)
  CodeMirror.defineMode = function(name, mode) {
    if (!CodeMirror.defaults.mode && name != "null") CodeMirror.defaults.mode = name;
    if (arguments.length > 2)
      mode.dependencies = Array.prototype.slice.call(arguments, 2);
    modes[name] = mode;
  };

  CodeMirror.defineMIME = function(mime, spec) {
    mimeModes[mime] = spec;
  };

  // Given a MIME type, a {name, ...options} config object, or a name
  // string, return a mode config object.
  CodeMirror.resolveMode = function(spec) {
    if (typeof spec == "string" && mimeModes.hasOwnProperty(spec)) {
      spec = mimeModes[spec];
    } else if (spec && typeof spec.name == "string" && mimeModes.hasOwnProperty(spec.name)) {
      var found = mimeModes[spec.name];
      if (typeof found == "string") found = {name: found};
      spec = createObj(found, spec);
      spec.name = found.name;
    } else if (typeof spec == "string" && /^[\w\-]+\/[\w\-]+\+xml$/.test(spec)) {
      return CodeMirror.resolveMode("application/xml");
    }
    if (typeof spec == "string") return {name: spec};
    else return spec || {name: "null"};
  };

  // Given a mode spec (anything that resolveMode accepts), find and
  // initialize an actual mode object.
  CodeMirror.getMode = function(options, spec) {
    var spec = CodeMirror.resolveMode(spec);
    var mfactory = modes[spec.name];
    if (!mfactory) return CodeMirror.getMode(options, "text/plain");
    var modeObj = mfactory(options, spec);
    if (modeExtensions.hasOwnProperty(spec.name)) {
      var exts = modeExtensions[spec.name];
      for (var prop in exts) {
        if (!exts.hasOwnProperty(prop)) continue;
        if (modeObj.hasOwnProperty(prop)) modeObj["_" + prop] = modeObj[prop];
        modeObj[prop] = exts[prop];
      }
    }
    modeObj.name = spec.name;
    if (spec.helperType) modeObj.helperType = spec.helperType;
    if (spec.modeProps) for (var prop in spec.modeProps)
      modeObj[prop] = spec.modeProps[prop];

    return modeObj;
  };

  // Minimal default mode.
  CodeMirror.defineMode("null", function() {
    return {token: function(stream) {stream.skipToEnd();}};
  });
  CodeMirror.defineMIME("text/plain", "null");

  // This can be used to attach properties to mode objects from
  // outside the actual mode definition.
  var modeExtensions = CodeMirror.modeExtensions = {};
  CodeMirror.extendMode = function(mode, properties) {
    var exts = modeExtensions.hasOwnProperty(mode) ? modeExtensions[mode] : (modeExtensions[mode] = {});
    copyObj(properties, exts);
  };

  // EXTENSIONS

  CodeMirror.defineExtension = function(name, func) {
    CodeMirror.prototype[name] = func;
  };
  CodeMirror.defineDocExtension = function(name, func) {
    Doc.prototype[name] = func;
  };
  CodeMirror.defineOption = option;

  var initHooks = [];
  CodeMirror.defineInitHook = function(f) {initHooks.push(f);};

  var helpers = CodeMirror.helpers = {};
  CodeMirror.registerHelper = function(type, name, value) {
    if (!helpers.hasOwnProperty(type)) helpers[type] = CodeMirror[type] = {_global: []};
    helpers[type][name] = value;
  };
  CodeMirror.registerGlobalHelper = function(type, name, predicate, value) {
    CodeMirror.registerHelper(type, name, value);
    helpers[type]._global.push({pred: predicate, val: value});
  };

  // MODE STATE HANDLING

  // Utility functions for working with state. Exported because nested
  // modes need to do this for their inner modes.

  var copyState = CodeMirror.copyState = function(mode, state) {
    if (state === true) return state;
    if (mode.copyState) return mode.copyState(state);
    var nstate = {};
    for (var n in state) {
      var val = state[n];
      if (val instanceof Array) val = val.concat([]);
      nstate[n] = val;
    }
    return nstate;
  };

  var startState = CodeMirror.startState = function(mode, a1, a2) {
    return mode.startState ? mode.startState(a1, a2) : true;
  };

  // Given a mode and a state (for that mode), find the inner mode and
  // state at the position that the state refers to.
  CodeMirror.innerMode = function(mode, state) {
    while (mode.innerMode) {
      var info = mode.innerMode(state);
      if (!info || info.mode == mode) break;
      state = info.state;
      mode = info.mode;
    }
    return info || {mode: mode, state: state};
  };

  // STANDARD COMMANDS

  // Commands are parameter-less actions that can be performed on an
  // editor, mostly used for keybindings.
  var commands = CodeMirror.commands = {
    selectAll: function(cm) {cm.setSelection(Pos(cm.firstLine(), 0), Pos(cm.lastLine()), sel_dontScroll);},
    singleSelection: function(cm) {
      cm.setSelection(cm.getCursor("anchor"), cm.getCursor("head"), sel_dontScroll);
    },
    killLine: function(cm) {
      deleteNearSelection(cm, function(range) {
        if (range.empty()) {
          var len = getLine(cm.doc, range.head.line).text.length;
          if (range.head.ch == len && range.head.line < cm.lastLine())
            return {from: range.head, to: Pos(range.head.line + 1, 0)};
          else
            return {from: range.head, to: Pos(range.head.line, len)};
        } else {
          return {from: range.from(), to: range.to()};
        }
      });
    },
    deleteLine: function(cm) {
      deleteNearSelection(cm, function(range) {
        return {from: Pos(range.from().line, 0),
                to: clipPos(cm.doc, Pos(range.to().line + 1, 0))};
      });
    },
    delLineLeft: function(cm) {
      deleteNearSelection(cm, function(range) {
        return {from: Pos(range.from().line, 0), to: range.from()};
      });
    },
    delWrappedLineLeft: function(cm) {
      deleteNearSelection(cm, function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var leftPos = cm.coordsChar({left: 0, top: top}, "div");
        return {from: leftPos, to: range.from()};
      });
    },
    delWrappedLineRight: function(cm) {
      deleteNearSelection(cm, function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var rightPos = cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
        return {from: range.from(), to: rightPos };
      });
    },
    undo: function(cm) {cm.undo();},
    redo: function(cm) {cm.redo();},
    undoSelection: function(cm) {cm.undoSelection();},
    redoSelection: function(cm) {cm.redoSelection();},
    goDocStart: function(cm) {cm.extendSelection(Pos(cm.firstLine(), 0));},
    goDocEnd: function(cm) {cm.extendSelection(Pos(cm.lastLine()));},
    goLineStart: function(cm) {
      cm.extendSelectionsBy(function(range) { return lineStart(cm, range.head.line); },
                            {origin: "+move", bias: 1});
    },
    goLineStartSmart: function(cm) {
      cm.extendSelectionsBy(function(range) {
        return lineStartSmart(cm, range.head);
      }, {origin: "+move", bias: 1});
    },
    goLineEnd: function(cm) {
      cm.extendSelectionsBy(function(range) { return lineEnd(cm, range.head.line); },
                            {origin: "+move", bias: -1});
    },
    goLineRight: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        return cm.coordsChar({left: cm.display.lineDiv.offsetWidth + 100, top: top}, "div");
      }, sel_move);
    },
    goLineLeft: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        return cm.coordsChar({left: 0, top: top}, "div");
      }, sel_move);
    },
    goLineLeftSmart: function(cm) {
      cm.extendSelectionsBy(function(range) {
        var top = cm.charCoords(range.head, "div").top + 5;
        var pos = cm.coordsChar({left: 0, top: top}, "div");
        if (pos.ch < cm.getLine(pos.line).search(/\S/)) return lineStartSmart(cm, range.head);
        return pos;
      }, sel_move);
    },
    goLineUp: function(cm) {cm.moveV(-1, "line");},
    goLineDown: function(cm) {cm.moveV(1, "line");},
    goPageUp: function(cm) {cm.moveV(-1, "page");},
    goPageDown: function(cm) {cm.moveV(1, "page");},
    goCharLeft: function(cm) {cm.moveH(-1, "char");},
    goCharRight: function(cm) {cm.moveH(1, "char");},
    goColumnLeft: function(cm) {cm.moveH(-1, "column");},
    goColumnRight: function(cm) {cm.moveH(1, "column");},
    goWordLeft: function(cm) {cm.moveH(-1, "word");},
    goGroupRight: function(cm) {cm.moveH(1, "group");},
    goGroupLeft: function(cm) {cm.moveH(-1, "group");},
    goWordRight: function(cm) {cm.moveH(1, "word");},
    delCharBefore: function(cm) {cm.deleteH(-1, "char");},
    delCharAfter: function(cm) {cm.deleteH(1, "char");},
    delWordBefore: function(cm) {cm.deleteH(-1, "word");},
    delWordAfter: function(cm) {cm.deleteH(1, "word");},
    delGroupBefore: function(cm) {cm.deleteH(-1, "group");},
    delGroupAfter: function(cm) {cm.deleteH(1, "group");},
    indentAuto: function(cm) {cm.indentSelection("smart");},
    indentMore: function(cm) {cm.indentSelection("add");},
    indentLess: function(cm) {cm.indentSelection("subtract");},
    insertTab: function(cm) {cm.replaceSelection("\t");},
    insertSoftTab: function(cm) {
      var spaces = [], ranges = cm.listSelections(), tabSize = cm.options.tabSize;
      for (var i = 0; i < ranges.length; i++) {
        var pos = ranges[i].from();
        var col = countColumn(cm.getLine(pos.line), pos.ch, tabSize);
        spaces.push(new Array(tabSize - col % tabSize + 1).join(" "));
      }
      cm.replaceSelections(spaces);
    },
    defaultTab: function(cm) {
      if (cm.somethingSelected()) cm.indentSelection("add");
      else cm.execCommand("insertTab");
    },
    transposeChars: function(cm) {
      runInOp(cm, function() {
        var ranges = cm.listSelections(), newSel = [];
        for (var i = 0; i < ranges.length; i++) {
          var cur = ranges[i].head, line = getLine(cm.doc, cur.line).text;
          if (line) {
            if (cur.ch == line.length) cur = new Pos(cur.line, cur.ch - 1);
            if (cur.ch > 0) {
              cur = new Pos(cur.line, cur.ch + 1);
              cm.replaceRange(line.charAt(cur.ch - 1) + line.charAt(cur.ch - 2),
                              Pos(cur.line, cur.ch - 2), cur, "+transpose");
            } else if (cur.line > cm.doc.first) {
              var prev = getLine(cm.doc, cur.line - 1).text;
              if (prev)
                cm.replaceRange(line.charAt(0) + cm.doc.lineSeparator() +
                                prev.charAt(prev.length - 1),
                                Pos(cur.line - 1, prev.length - 1), Pos(cur.line, 1), "+transpose");
            }
          }
          newSel.push(new Range(cur, cur));
        }
        cm.setSelections(newSel);
      });
    },
    newlineAndIndent: function(cm) {
      runInOp(cm, function() {
        var len = cm.listSelections().length;
        for (var i = 0; i < len; i++) {
          var range = cm.listSelections()[i];
          cm.replaceRange(cm.doc.lineSeparator(), range.anchor, range.head, "+input");
          cm.indentLine(range.from().line + 1, null, true);
        }
        ensureCursorVisible(cm);
      });
    },
    toggleOverwrite: function(cm) {cm.toggleOverwrite();}
  };


  // STANDARD KEYMAPS

  var keyMap = CodeMirror.keyMap = {};

  keyMap.basic = {
    "Left": "goCharLeft", "Right": "goCharRight", "Up": "goLineUp", "Down": "goLineDown",
    "End": "goLineEnd", "Home": "goLineStartSmart", "PageUp": "goPageUp", "PageDown": "goPageDown",
    "Delete": "delCharAfter", "Backspace": "delCharBefore", "Shift-Backspace": "delCharBefore",
    "Tab": "defaultTab", "Shift-Tab": "indentAuto",
    "Enter": "newlineAndIndent", "Insert": "toggleOverwrite",
    "Esc": "singleSelection"
  };
  // Note that the save and find-related commands aren't defined by
  // default. User code or addons can define them. Unknown commands
  // are simply ignored.
  keyMap.pcDefault = {
    "Ctrl-A": "selectAll", "Ctrl-D": "deleteLine", "Ctrl-Z": "undo", "Shift-Ctrl-Z": "redo", "Ctrl-Y": "redo",
    "Ctrl-Home": "goDocStart", "Ctrl-End": "goDocEnd", "Ctrl-Up": "goLineUp", "Ctrl-Down": "goLineDown",
    "Ctrl-Left": "goGroupLeft", "Ctrl-Right": "goGroupRight", "Alt-Left": "goLineStart", "Alt-Right": "goLineEnd",
    "Ctrl-Backspace": "delGroupBefore", "Ctrl-Delete": "delGroupAfter", "Ctrl-S": "save", "Ctrl-F": "find",
    "Ctrl-G": "findNext", "Shift-Ctrl-G": "findPrev", "Shift-Ctrl-F": "replace", "Shift-Ctrl-R": "replaceAll",
    "Ctrl-[": "indentLess", "Ctrl-]": "indentMore",
    "Ctrl-U": "undoSelection", "Shift-Ctrl-U": "redoSelection", "Alt-U": "redoSelection",
    fallthrough: "basic"
  };
  // Very basic readline/emacs-style bindings, which are standard on Mac.
  keyMap.emacsy = {
    "Ctrl-F": "goCharRight", "Ctrl-B": "goCharLeft", "Ctrl-P": "goLineUp", "Ctrl-N": "goLineDown",
    "Alt-F": "goWordRight", "Alt-B": "goWordLeft", "Ctrl-A": "goLineStart", "Ctrl-E": "goLineEnd",
    "Ctrl-V": "goPageDown", "Shift-Ctrl-V": "goPageUp", "Ctrl-D": "delCharAfter", "Ctrl-H": "delCharBefore",
    "Alt-D": "delWordAfter", "Alt-Backspace": "delWordBefore", "Ctrl-K": "killLine", "Ctrl-T": "transposeChars"
  };
  keyMap.macDefault = {
    "Cmd-A": "selectAll", "Cmd-D": "deleteLine", "Cmd-Z": "undo", "Shift-Cmd-Z": "redo", "Cmd-Y": "redo",
    "Cmd-Home": "goDocStart", "Cmd-Up": "goDocStart", "Cmd-End": "goDocEnd", "Cmd-Down": "goDocEnd", "Alt-Left": "goGroupLeft",
    "Alt-Right": "goGroupRight", "Cmd-Left": "goLineLeft", "Cmd-Right": "goLineRight", "Alt-Backspace": "delGroupBefore",
    "Ctrl-Alt-Backspace": "delGroupAfter", "Alt-Delete": "delGroupAfter", "Cmd-S": "save", "Cmd-F": "find",
    "Cmd-G": "findNext", "Shift-Cmd-G": "findPrev", "Cmd-Alt-F": "replace", "Shift-Cmd-Alt-F": "replaceAll",
    "Cmd-[": "indentLess", "Cmd-]": "indentMore", "Cmd-Backspace": "delWrappedLineLeft", "Cmd-Delete": "delWrappedLineRight",
    "Cmd-U": "undoSelection", "Shift-Cmd-U": "redoSelection", "Ctrl-Up": "goDocStart", "Ctrl-Down": "goDocEnd",
    fallthrough: ["basic", "emacsy"]
  };
  keyMap["default"] = mac ? keyMap.macDefault : keyMap.pcDefault;

  // KEYMAP DISPATCH

  function normalizeKeyName(name) {
    var parts = name.split(/-(?!$)/), name = parts[parts.length - 1];
    var alt, ctrl, shift, cmd;
    for (var i = 0; i < parts.length - 1; i++) {
      var mod = parts[i];
      if (/^(cmd|meta|m)$/i.test(mod)) cmd = true;
      else if (/^a(lt)?$/i.test(mod)) alt = true;
      else if (/^(c|ctrl|control)$/i.test(mod)) ctrl = true;
      else if (/^s(hift)$/i.test(mod)) shift = true;
      else throw new Error("Unrecognized modifier name: " + mod);
    }
    if (alt) name = "Alt-" + name;
    if (ctrl) name = "Ctrl-" + name;
    if (cmd) name = "Cmd-" + name;
    if (shift) name = "Shift-" + name;
    return name;
  }

  // This is a kludge to keep keymaps mostly working as raw objects
  // (backwards compatibility) while at the same time support features
  // like normalization and multi-stroke key bindings. It compiles a
  // new normalized keymap, and then updates the old object to reflect
  // this.
  CodeMirror.normalizeKeyMap = function(keymap) {
    var copy = {};
    for (var keyname in keymap) if (keymap.hasOwnProperty(keyname)) {
      var value = keymap[keyname];
      if (/^(name|fallthrough|(de|at)tach)$/.test(keyname)) continue;
      if (value == "...") { delete keymap[keyname]; continue; }

      var keys = map(keyname.split(" "), normalizeKeyName);
      for (var i = 0; i < keys.length; i++) {
        var val, name;
        if (i == keys.length - 1) {
          name = keys.join(" ");
          val = value;
        } else {
          name = keys.slice(0, i + 1).join(" ");
          val = "...";
        }
        var prev = copy[name];
        if (!prev) copy[name] = val;
        else if (prev != val) throw new Error("Inconsistent bindings for " + name);
      }
      delete keymap[keyname];
    }
    for (var prop in copy) keymap[prop] = copy[prop];
    return keymap;
  };

  var lookupKey = CodeMirror.lookupKey = function(key, map, handle, context) {
    map = getKeyMap(map);
    var found = map.call ? map.call(key, context) : map[key];
    if (found === false) return "nothing";
    if (found === "...") return "multi";
    if (found != null && handle(found)) return "handled";

    if (map.fallthrough) {
      if (Object.prototype.toString.call(map.fallthrough) != "[object Array]")
        return lookupKey(key, map.fallthrough, handle, context);
      for (var i = 0; i < map.fallthrough.length; i++) {
        var result = lookupKey(key, map.fallthrough[i], handle, context);
        if (result) return result;
      }
    }
  };

  // Modifier key presses don't count as 'real' key presses for the
  // purpose of keymap fallthrough.
  var isModifierKey = CodeMirror.isModifierKey = function(value) {
    var name = typeof value == "string" ? value : keyNames[value.keyCode];
    return name == "Ctrl" || name == "Alt" || name == "Shift" || name == "Mod";
  };

  // Look up the name of a key as indicated by an event object.
  var keyName = CodeMirror.keyName = function(event, noShift) {
    if (presto && event.keyCode == 34 && event["char"]) return false;
    var base = keyNames[event.keyCode], name = base;
    if (name == null || event.altGraphKey) return false;
    if (event.altKey && base != "Alt") name = "Alt-" + name;
    if ((flipCtrlCmd ? event.metaKey : event.ctrlKey) && base != "Ctrl") name = "Ctrl-" + name;
    if ((flipCtrlCmd ? event.ctrlKey : event.metaKey) && base != "Cmd") name = "Cmd-" + name;
    if (!noShift && event.shiftKey && base != "Shift") name = "Shift-" + name;
    return name;
  };

  function getKeyMap(val) {
    return typeof val == "string" ? keyMap[val] : val;
  }

  // FROMTEXTAREA

  CodeMirror.fromTextArea = function(textarea, options) {
    options = options ? copyObj(options) : {};
    options.value = textarea.value;
    if (!options.tabindex && textarea.tabIndex)
      options.tabindex = textarea.tabIndex;
    if (!options.placeholder && textarea.placeholder)
      options.placeholder = textarea.placeholder;
    // Set autofocus to true if this textarea is focused, or if it has
    // autofocus and no other element is focused.
    if (options.autofocus == null) {
      var hasFocus = activeElt();
      options.autofocus = hasFocus == textarea ||
        textarea.getAttribute("autofocus") != null && hasFocus == document.body;
    }

    function save() {textarea.value = cm.getValue();}
    if (textarea.form) {
      on(textarea.form, "submit", save);
      // Deplorable hack to make the submit method do the right thing.
      if (!options.leaveSubmitMethodAlone) {
        var form = textarea.form, realSubmit = form.submit;
        try {
          var wrappedSubmit = form.submit = function() {
            save();
            form.submit = realSubmit;
            form.submit();
            form.submit = wrappedSubmit;
          };
        } catch(e) {}
      }
    }

    options.finishInit = function(cm) {
      cm.save = save;
      cm.getTextArea = function() { return textarea; };
      cm.toTextArea = function() {
        cm.toTextArea = isNaN; // Prevent this from being ran twice
        save();
        textarea.parentNode.removeChild(cm.getWrapperElement());
        textarea.style.display = "";
        if (textarea.form) {
          off(textarea.form, "submit", save);
          if (typeof textarea.form.submit == "function")
            textarea.form.submit = realSubmit;
        }
      };
    };

    textarea.style.display = "none";
    var cm = CodeMirror(function(node) {
      textarea.parentNode.insertBefore(node, textarea.nextSibling);
    }, options);
    return cm;
  };

  // STRING STREAM

  // Fed to the mode parsers, provides helper functions to make
  // parsers more succinct.

  var StringStream = CodeMirror.StringStream = function(string, tabSize) {
    this.pos = this.start = 0;
    this.string = string;
    this.tabSize = tabSize || 8;
    this.lastColumnPos = this.lastColumnValue = 0;
    this.lineStart = 0;
  };

  StringStream.prototype = {
    eol: function() {return this.pos >= this.string.length;},
    sol: function() {return this.pos == this.lineStart;},
    peek: function() {return this.string.charAt(this.pos) || undefined;},
    next: function() {
      if (this.pos < this.string.length)
        return this.string.charAt(this.pos++);
    },
    eat: function(match) {
      var ch = this.string.charAt(this.pos);
      if (typeof match == "string") var ok = ch == match;
      else var ok = ch && (match.test ? match.test(ch) : match(ch));
      if (ok) {++this.pos; return ch;}
    },
    eatWhile: function(match) {
      var start = this.pos;
      while (this.eat(match)){}
      return this.pos > start;
    },
    eatSpace: function() {
      var start = this.pos;
      while (/[\s\u00a0]/.test(this.string.charAt(this.pos))) ++this.pos;
      return this.pos > start;
    },
    skipToEnd: function() {this.pos = this.string.length;},
    skipTo: function(ch) {
      var found = this.string.indexOf(ch, this.pos);
      if (found > -1) {this.pos = found; return true;}
    },
    backUp: function(n) {this.pos -= n;},
    column: function() {
      if (this.lastColumnPos < this.start) {
        this.lastColumnValue = countColumn(this.string, this.start, this.tabSize, this.lastColumnPos, this.lastColumnValue);
        this.lastColumnPos = this.start;
      }
      return this.lastColumnValue - (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    indentation: function() {
      return countColumn(this.string, null, this.tabSize) -
        (this.lineStart ? countColumn(this.string, this.lineStart, this.tabSize) : 0);
    },
    match: function(pattern, consume, caseInsensitive) {
      if (typeof pattern == "string") {
        var cased = function(str) {return caseInsensitive ? str.toLowerCase() : str;};
        var substr = this.string.substr(this.pos, pattern.length);
        if (cased(substr) == cased(pattern)) {
          if (consume !== false) this.pos += pattern.length;
          return true;
        }
      } else {
        var match = this.string.slice(this.pos).match(pattern);
        if (match && match.index > 0) return null;
        if (match && consume !== false) this.pos += match[0].length;
        return match;
      }
    },
    current: function(){return this.string.slice(this.start, this.pos);},
    hideFirstChars: function(n, inner) {
      this.lineStart += n;
      try { return inner(); }
      finally { this.lineStart -= n; }
    }
  };

  // TEXTMARKERS

  // Created with markText and setBookmark methods. A TextMarker is a
  // handle that can be used to clear or find a marked position in the
  // document. Line objects hold arrays (markedSpans) containing
  // {from, to, marker} object pointing to such marker objects, and
  // indicating that such a marker is present on that line. Multiple
  // lines may point to the same marker when it spans across lines.
  // The spans will have null for their from/to properties when the
  // marker continues beyond the start/end of the line. Markers have
  // links back to the lines they currently touch.

  var nextMarkerId = 0;

  var TextMarker = CodeMirror.TextMarker = function(doc, type) {
    this.lines = [];
    this.type = type;
    this.doc = doc;
    this.id = ++nextMarkerId;
  };
  eventMixin(TextMarker);

  // Clear the marker.
  TextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    var cm = this.doc.cm, withOp = cm && !cm.curOp;
    if (withOp) startOperation(cm);
    if (hasHandler(this, "clear")) {
      var found = this.find();
      if (found) signalLater(this, "clear", found.from, found.to);
    }
    var min = null, max = null;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (cm && !this.collapsed) regLineChange(cm, lineNo(line), "text");
      else if (cm) {
        if (span.to != null) max = lineNo(line);
        if (span.from != null) min = lineNo(line);
      }
      line.markedSpans = removeMarkedSpan(line.markedSpans, span);
      if (span.from == null && this.collapsed && !lineIsHidden(this.doc, line) && cm)
        updateLineHeight(line, textHeight(cm.display));
    }
    if (cm && this.collapsed && !cm.options.lineWrapping) for (var i = 0; i < this.lines.length; ++i) {
      var visual = visualLine(this.lines[i]), len = lineLength(visual);
      if (len > cm.display.maxLineLength) {
        cm.display.maxLine = visual;
        cm.display.maxLineLength = len;
        cm.display.maxLineChanged = true;
      }
    }

    if (min != null && cm && this.collapsed) regChange(cm, min, max + 1);
    this.lines.length = 0;
    this.explicitlyCleared = true;
    if (this.atomic && this.doc.cantEdit) {
      this.doc.cantEdit = false;
      if (cm) reCheckSelection(cm.doc);
    }
    if (cm) signalLater(cm, "markerCleared", cm, this);
    if (withOp) endOperation(cm);
    if (this.parent) this.parent.clear();
  };

  // Find the position of the marker in the document. Returns a {from,
  // to} object by default. Side can be passed to get a specific side
  // -- 0 (both), -1 (left), or 1 (right). When lineObj is true, the
  // Pos objects returned contain a line object, rather than a line
  // number (used to prevent looking up the same line twice).
  TextMarker.prototype.find = function(side, lineObj) {
    if (side == null && this.type == "bookmark") side = 1;
    var from, to;
    for (var i = 0; i < this.lines.length; ++i) {
      var line = this.lines[i];
      var span = getMarkedSpanFor(line.markedSpans, this);
      if (span.from != null) {
        from = Pos(lineObj ? line : lineNo(line), span.from);
        if (side == -1) return from;
      }
      if (span.to != null) {
        to = Pos(lineObj ? line : lineNo(line), span.to);
        if (side == 1) return to;
      }
    }
    return from && {from: from, to: to};
  };

  // Signals that the marker's widget changed, and surrounding layout
  // should be recomputed.
  TextMarker.prototype.changed = function() {
    var pos = this.find(-1, true), widget = this, cm = this.doc.cm;
    if (!pos || !cm) return;
    runInOp(cm, function() {
      var line = pos.line, lineN = lineNo(pos.line);
      var view = findViewForLine(cm, lineN);
      if (view) {
        clearLineMeasurementCacheFor(view);
        cm.curOp.selectionChanged = cm.curOp.forceUpdate = true;
      }
      cm.curOp.updateMaxLine = true;
      if (!lineIsHidden(widget.doc, line) && widget.height != null) {
        var oldHeight = widget.height;
        widget.height = null;
        var dHeight = widgetHeight(widget) - oldHeight;
        if (dHeight)
          updateLineHeight(line, line.height + dHeight);
      }
    });
  };

  TextMarker.prototype.attachLine = function(line) {
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      if (!op.maybeHiddenMarkers || indexOf(op.maybeHiddenMarkers, this) == -1)
        (op.maybeUnhiddenMarkers || (op.maybeUnhiddenMarkers = [])).push(this);
    }
    this.lines.push(line);
  };
  TextMarker.prototype.detachLine = function(line) {
    this.lines.splice(indexOf(this.lines, line), 1);
    if (!this.lines.length && this.doc.cm) {
      var op = this.doc.cm.curOp;
      (op.maybeHiddenMarkers || (op.maybeHiddenMarkers = [])).push(this);
    }
  };

  // Collapsed markers have unique ids, in order to be able to order
  // them, which is needed for uniquely determining an outer marker
  // when they overlap (they may nest, but not partially overlap).
  var nextMarkerId = 0;

  // Create a marker, wire it up to the right lines, and
  function markText(doc, from, to, options, type) {
    // Shared markers (across linked documents) are handled separately
    // (markTextShared will call out to this again, once per
    // document).
    if (options && options.shared) return markTextShared(doc, from, to, options, type);
    // Ensure we are in an operation.
    if (doc.cm && !doc.cm.curOp) return operation(doc.cm, markText)(doc, from, to, options, type);

    var marker = new TextMarker(doc, type), diff = cmp(from, to);
    if (options) copyObj(options, marker, false);
    // Don't connect empty markers unless clearWhenEmpty is false
    if (diff > 0 || diff == 0 && marker.clearWhenEmpty !== false)
      return marker;
    if (marker.replacedWith) {
      // Showing up as a widget implies collapsed (widget replaces text)
      marker.collapsed = true;
      marker.widgetNode = elt("span", [marker.replacedWith], "CodeMirror-widget");
      if (!options.handleMouseEvents) marker.widgetNode.setAttribute("cm-ignore-events", "true");
      if (options.insertLeft) marker.widgetNode.insertLeft = true;
    }
    if (marker.collapsed) {
      if (conflictingCollapsedRange(doc, from.line, from, to, marker) ||
          from.line != to.line && conflictingCollapsedRange(doc, to.line, from, to, marker))
        throw new Error("Inserting collapsed marker partially overlapping an existing one");
      sawCollapsedSpans = true;
    }

    if (marker.addToHistory)
      addChangeToHistory(doc, {from: from, to: to, origin: "markText"}, doc.sel, NaN);

    var curLine = from.line, cm = doc.cm, updateMaxLine;
    doc.iter(curLine, to.line + 1, function(line) {
      if (cm && marker.collapsed && !cm.options.lineWrapping && visualLine(line) == cm.display.maxLine)
        updateMaxLine = true;
      if (marker.collapsed && curLine != from.line) updateLineHeight(line, 0);
      addMarkedSpan(line, new MarkedSpan(marker,
                                         curLine == from.line ? from.ch : null,
                                         curLine == to.line ? to.ch : null));
      ++curLine;
    });
    // lineIsHidden depends on the presence of the spans, so needs a second pass
    if (marker.collapsed) doc.iter(from.line, to.line + 1, function(line) {
      if (lineIsHidden(doc, line)) updateLineHeight(line, 0);
    });

    if (marker.clearOnEnter) on(marker, "beforeCursorEnter", function() { marker.clear(); });

    if (marker.readOnly) {
      sawReadOnlySpans = true;
      if (doc.history.done.length || doc.history.undone.length)
        doc.clearHistory();
    }
    if (marker.collapsed) {
      marker.id = ++nextMarkerId;
      marker.atomic = true;
    }
    if (cm) {
      // Sync editor state
      if (updateMaxLine) cm.curOp.updateMaxLine = true;
      if (marker.collapsed)
        regChange(cm, from.line, to.line + 1);
      else if (marker.className || marker.title || marker.startStyle || marker.endStyle || marker.css)
        for (var i = from.line; i <= to.line; i++) regLineChange(cm, i, "text");
      if (marker.atomic) reCheckSelection(cm.doc);
      signalLater(cm, "markerAdded", cm, marker);
    }
    return marker;
  }

  // SHARED TEXTMARKERS

  // A shared marker spans multiple linked documents. It is
  // implemented as a meta-marker-object controlling multiple normal
  // markers.
  var SharedTextMarker = CodeMirror.SharedTextMarker = function(markers, primary) {
    this.markers = markers;
    this.primary = primary;
    for (var i = 0; i < markers.length; ++i)
      markers[i].parent = this;
  };
  eventMixin(SharedTextMarker);

  SharedTextMarker.prototype.clear = function() {
    if (this.explicitlyCleared) return;
    this.explicitlyCleared = true;
    for (var i = 0; i < this.markers.length; ++i)
      this.markers[i].clear();
    signalLater(this, "clear");
  };
  SharedTextMarker.prototype.find = function(side, lineObj) {
    return this.primary.find(side, lineObj);
  };

  function markTextShared(doc, from, to, options, type) {
    options = copyObj(options);
    options.shared = false;
    var markers = [markText(doc, from, to, options, type)], primary = markers[0];
    var widget = options.widgetNode;
    linkedDocs(doc, function(doc) {
      if (widget) options.widgetNode = widget.cloneNode(true);
      markers.push(markText(doc, clipPos(doc, from), clipPos(doc, to), options, type));
      for (var i = 0; i < doc.linked.length; ++i)
        if (doc.linked[i].isParent) return;
      primary = lst(markers);
    });
    return new SharedTextMarker(markers, primary);
  }

  function findSharedMarkers(doc) {
    return doc.findMarks(Pos(doc.first, 0), doc.clipPos(Pos(doc.lastLine())),
                         function(m) { return m.parent; });
  }

  function copySharedMarkers(doc, markers) {
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i], pos = marker.find();
      var mFrom = doc.clipPos(pos.from), mTo = doc.clipPos(pos.to);
      if (cmp(mFrom, mTo)) {
        var subMark = markText(doc, mFrom, mTo, marker.primary, marker.primary.type);
        marker.markers.push(subMark);
        subMark.parent = marker;
      }
    }
  }

  function detachSharedMarkers(markers) {
    for (var i = 0; i < markers.length; i++) {
      var marker = markers[i], linked = [marker.primary.doc];;
      linkedDocs(marker.primary.doc, function(d) { linked.push(d); });
      for (var j = 0; j < marker.markers.length; j++) {
        var subMarker = marker.markers[j];
        if (indexOf(linked, subMarker.doc) == -1) {
          subMarker.parent = null;
          marker.markers.splice(j--, 1);
        }
      }
    }
  }

  // TEXTMARKER SPANS

  function MarkedSpan(marker, from, to) {
    this.marker = marker;
    this.from = from; this.to = to;
  }

  // Search an array of spans for a span matching the given marker.
  function getMarkedSpanFor(spans, marker) {
    if (spans) for (var i = 0; i < spans.length; ++i) {
      var span = spans[i];
      if (span.marker == marker) return span;
    }
  }
  // Remove a span from an array, returning undefined if no spans are
  // left (we don't store arrays for lines without spans).
  function removeMarkedSpan(spans, span) {
    for (var r, i = 0; i < spans.length; ++i)
      if (spans[i] != span) (r || (r = [])).push(spans[i]);
    return r;
  }
  // Add a span to a line.
  function addMarkedSpan(line, span) {
    line.markedSpans = line.markedSpans ? line.markedSpans.concat([span]) : [span];
    span.marker.attachLine(line);
  }

  // Used for the algorithm that adjusts markers for a change in the
  // document. These functions cut an array of spans at a given
  // character position, returning an array of remaining chunks (or
  // undefined if nothing remains).
  function markedSpansBefore(old, startCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= startCh : span.from < startCh);
      if (startsBefore || span.from == startCh && marker.type == "bookmark" && (!isInsert || !span.marker.insertLeft)) {
        var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= startCh : span.to > startCh);
        (nw || (nw = [])).push(new MarkedSpan(marker, span.from, endsAfter ? null : span.to));
      }
    }
    return nw;
  }
  function markedSpansAfter(old, endCh, isInsert) {
    if (old) for (var i = 0, nw; i < old.length; ++i) {
      var span = old[i], marker = span.marker;
      var endsAfter = span.to == null || (marker.inclusiveRight ? span.to >= endCh : span.to > endCh);
      if (endsAfter || span.from == endCh && marker.type == "bookmark" && (!isInsert || span.marker.insertLeft)) {
        var startsBefore = span.from == null || (marker.inclusiveLeft ? span.from <= endCh : span.from < endCh);
        (nw || (nw = [])).push(new MarkedSpan(marker, startsBefore ? null : span.from - endCh,
                                              span.to == null ? null : span.to - endCh));
      }
    }
    return nw;
  }

  // Given a change object, compute the new set of marker spans that
  // cover the line in which the change took place. Removes spans
  // entirely within the change, reconnects spans belonging to the
  // same marker that appear on both sides of the change, and cuts off
  // spans partially within the change. Returns an array of span
  // arrays with one element for each line in (after) the change.
  function stretchSpansOverChange(doc, change) {
    if (change.full) return null;
    var oldFirst = isLine(doc, change.from.line) && getLine(doc, change.from.line).markedSpans;
    var oldLast = isLine(doc, change.to.line) && getLine(doc, change.to.line).markedSpans;
    if (!oldFirst && !oldLast) return null;

    var startCh = change.from.ch, endCh = change.to.ch, isInsert = cmp(change.from, change.to) == 0;
    // Get the spans that 'stick out' on both sides
    var first = markedSpansBefore(oldFirst, startCh, isInsert);
    var last = markedSpansAfter(oldLast, endCh, isInsert);

    // Next, merge those two ends
    var sameLine = change.text.length == 1, offset = lst(change.text).length + (sameLine ? startCh : 0);
    if (first) {
      // Fix up .to properties of first
      for (var i = 0; i < first.length; ++i) {
        var span = first[i];
        if (span.to == null) {
          var found = getMarkedSpanFor(last, span.marker);
          if (!found) span.to = startCh;
          else if (sameLine) span.to = found.to == null ? null : found.to + offset;
        }
      }
    }
    if (last) {
      // Fix up .from in last (or move them into first in case of sameLine)
      for (var i = 0; i < last.length; ++i) {
        var span = last[i];
        if (span.to != null) span.to += offset;
        if (span.from == null) {
          var found = getMarkedSpanFor(first, span.marker);
          if (!found) {
            span.from = offset;
            if (sameLine) (first || (first = [])).push(span);
          }
        } else {
          span.from += offset;
          if (sameLine) (first || (first = [])).push(span);
        }
      }
    }
    // Make sure we didn't create any zero-length spans
    if (first) first = clearEmptySpans(first);
    if (last && last != first) last = clearEmptySpans(last);

    var newMarkers = [first];
    if (!sameLine) {
      // Fill gap with whole-line-spans
      var gap = change.text.length - 2, gapMarkers;
      if (gap > 0 && first)
        for (var i = 0; i < first.length; ++i)
          if (first[i].to == null)
            (gapMarkers || (gapMarkers = [])).push(new MarkedSpan(first[i].marker, null, null));
      for (var i = 0; i < gap; ++i)
        newMarkers.push(gapMarkers);
      newMarkers.push(last);
    }
    return newMarkers;
  }

  // Remove spans that are empty and don't have a clearWhenEmpty
  // option of false.
  function clearEmptySpans(spans) {
    for (var i = 0; i < spans.length; ++i) {
      var span = spans[i];
      if (span.from != null && span.from == span.to && span.marker.clearWhenEmpty !== false)
        spans.splice(i--, 1);
    }
    if (!spans.length) return null;
    return spans;
  }

  // Used for un/re-doing changes from the history. Combines the
  // result of computing the existing spans with the set of spans that
  // existed in the history (so that deleting around a span and then
  // undoing brings back the span).
  function mergeOldSpans(doc, change) {
    var old = getOldSpans(doc, change);
    var stretched = stretchSpansOverChange(doc, change);
    if (!old) return stretched;
    if (!stretched) return old;

    for (var i = 0; i < old.length; ++i) {
      var oldCur = old[i], stretchCur = stretched[i];
      if (oldCur && stretchCur) {
        spans: for (var j = 0; j < stretchCur.length; ++j) {
          var span = stretchCur[j];
          for (var k = 0; k < oldCur.length; ++k)
            if (oldCur[k].marker == span.marker) continue spans;
          oldCur.push(span);
        }
      } else if (stretchCur) {
        old[i] = stretchCur;
      }
    }
    return old;
  }

  // Used to 'clip' out readOnly ranges when making a change.
  function removeReadOnlyRanges(doc, from, to) {
    var markers = null;
    doc.iter(from.line, to.line + 1, function(line) {
      if (line.markedSpans) for (var i = 0; i < line.markedSpans.length; ++i) {
        var mark = line.markedSpans[i].marker;
        if (mark.readOnly && (!markers || indexOf(markers, mark) == -1))
          (markers || (markers = [])).push(mark);
      }
    });
    if (!markers) return null;
    var parts = [{from: from, to: to}];
    for (var i = 0; i < markers.length; ++i) {
      var mk = markers[i], m = mk.find(0);
      for (var j = 0; j < parts.length; ++j) {
        var p = parts[j];
        if (cmp(p.to, m.from) < 0 || cmp(p.from, m.to) > 0) continue;
        var newParts = [j, 1], dfrom = cmp(p.from, m.from), dto = cmp(p.to, m.to);
        if (dfrom < 0 || !mk.inclusiveLeft && !dfrom)
          newParts.push({from: p.from, to: m.from});
        if (dto > 0 || !mk.inclusiveRight && !dto)
          newParts.push({from: m.to, to: p.to});
        parts.splice.apply(parts, newParts);
        j += newParts.length - 1;
      }
    }
    return parts;
  }

  // Connect or disconnect spans from a line.
  function detachMarkedSpans(line) {
    var spans = line.markedSpans;
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.detachLine(line);
    line.markedSpans = null;
  }
  function attachMarkedSpans(line, spans) {
    if (!spans) return;
    for (var i = 0; i < spans.length; ++i)
      spans[i].marker.attachLine(line);
    line.markedSpans = spans;
  }

  // Helpers used when computing which overlapping collapsed span
  // counts as the larger one.
  function extraLeft(marker) { return marker.inclusiveLeft ? -1 : 0; }
  function extraRight(marker) { return marker.inclusiveRight ? 1 : 0; }

  // Returns a number indicating which of two overlapping collapsed
  // spans is larger (and thus includes the other). Falls back to
  // comparing ids when the spans cover exactly the same range.
  function compareCollapsedMarkers(a, b) {
    var lenDiff = a.lines.length - b.lines.length;
    if (lenDiff != 0) return lenDiff;
    var aPos = a.find(), bPos = b.find();
    var fromCmp = cmp(aPos.from, bPos.from) || extraLeft(a) - extraLeft(b);
    if (fromCmp) return -fromCmp;
    var toCmp = cmp(aPos.to, bPos.to) || extraRight(a) - extraRight(b);
    if (toCmp) return toCmp;
    return b.id - a.id;
  }

  // Find out whether a line ends or starts in a collapsed span. If
  // so, return the marker for that span.
  function collapsedSpanAtSide(line, start) {
    var sps = sawCollapsedSpans && line.markedSpans, found;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (sp.marker.collapsed && (start ? sp.from : sp.to) == null &&
          (!found || compareCollapsedMarkers(found, sp.marker) < 0))
        found = sp.marker;
    }
    return found;
  }
  function collapsedSpanAtStart(line) { return collapsedSpanAtSide(line, true); }
  function collapsedSpanAtEnd(line) { return collapsedSpanAtSide(line, false); }

  // Test whether there exists a collapsed span that partially
  // overlaps (covers the start or end, but not both) of a new span.
  // Such overlap is not allowed.
  function conflictingCollapsedRange(doc, lineNo, from, to, marker) {
    var line = getLine(doc, lineNo);
    var sps = sawCollapsedSpans && line.markedSpans;
    if (sps) for (var i = 0; i < sps.length; ++i) {
      var sp = sps[i];
      if (!sp.marker.collapsed) continue;
      var found = sp.marker.find(0);
      var fromCmp = cmp(found.from, from) || extraLeft(sp.marker) - extraLeft(marker);
      var toCmp = cmp(found.to, to) || extraRight(sp.marker) - extraRight(marker);
      if (fromCmp >= 0 && toCmp <= 0 || fromCmp <= 0 && toCmp >= 0) continue;
      if (fromCmp <= 0 && (cmp(found.to, from) > 0 || (sp.marker.inclusiveRight && marker.inclusiveLeft)) ||
          fromCmp >= 0 && (cmp(found.from, to) < 0 || (sp.marker.inclusiveLeft && marker.inclusiveRight)))
        return true;
    }
  }

  // A visual line is a line as drawn on the screen. Folding, for
  // example, can cause multiple logical lines to appear on the same
  // visual line. This finds the start of the visual line that the
  // given line is part of (usually that is the line itself).
  function visualLine(line) {
    var merged;
    while (merged = collapsedSpanAtStart(line))
      line = merged.find(-1, true).line;
    return line;
  }

  // Returns an array of logical lines that continue the visual line
  // started by the argument, or undefined if there are no such lines.
  function visualLineContinued(line) {
    var merged, lines;
    while (merged = collapsedSpanAtEnd(line)) {
      line = merged.find(1, true).line;
      (lines || (lines = [])).push(line);
    }
    return lines;
  }

  // Get the line number of the start of the visual line that the
  // given line number is part of.
  function visualLineNo(doc, lineN) {
    var line = getLine(doc, lineN), vis = visualLine(line);
    if (line == vis) return lineN;
    return lineNo(vis);
  }
  // Get the line number of the start of the next visual line after
  // the given line.
  function visualLineEndNo(doc, lineN) {
    if (lineN > doc.lastLine()) return lineN;
    var line = getLine(doc, lineN), merged;
    if (!lineIsHidden(doc, line)) return lineN;
    while (merged = collapsedSpanAtEnd(line))
      line = merged.find(1, true).line;
    return lineNo(line) + 1;
  }

  // Compute whether a line is hidden. Lines count as hidden when they
  // are part of a visual line that starts with another line, or when
  // they are entirely covered by collapsed, non-widget span.
  function lineIsHidden(doc, line) {
    var sps = sawCollapsedSpans && line.markedSpans;
    if (sps) for (var sp, i = 0; i < sps.length; ++i) {
      sp = sps[i];
      if (!sp.marker.collapsed) continue;
      if (sp.from == null) return true;
      if (sp.marker.widgetNode) continue;
      if (sp.from == 0 && sp.marker.inclusiveLeft && lineIsHiddenInner(doc, line, sp))
        return true;
    }
  }
  function lineIsHiddenInner(doc, line, span) {
    if (span.to == null) {
      var end = span.marker.find(1, true);
      return lineIsHiddenInner(doc, end.line, getMarkedSpanFor(end.line.markedSpans, span.marker));
    }
    if (span.marker.inclusiveRight && span.to == line.text.length)
      return true;
    for (var sp, i = 0; i < line.markedSpans.length; ++i) {
      sp = line.markedSpans[i];
      if (sp.marker.collapsed && !sp.marker.widgetNode && sp.from == span.to &&
          (sp.to == null || sp.to != span.from) &&
          (sp.marker.inclusiveLeft || span.marker.inclusiveRight) &&
          lineIsHiddenInner(doc, line, sp)) return true;
    }
  }

  // LINE WIDGETS

  // Line widgets are block elements displayed above or below a line.

  var LineWidget = CodeMirror.LineWidget = function(doc, node, options) {
    if (options) for (var opt in options) if (options.hasOwnProperty(opt))
      this[opt] = options[opt];
    this.doc = doc;
    this.node = node;
  };
  eventMixin(LineWidget);

  function adjustScrollWhenAboveVisible(cm, line, diff) {
    if (heightAtLine(line) < ((cm.curOp && cm.curOp.scrollTop) || cm.doc.scrollTop))
      addToScrollPos(cm, null, diff);
  }

  LineWidget.prototype.clear = function() {
    var cm = this.doc.cm, ws = this.line.widgets, line = this.line, no = lineNo(line);
    if (no == null || !ws) return;
    for (var i = 0; i < ws.length; ++i) if (ws[i] == this) ws.splice(i--, 1);
    if (!ws.length) line.widgets = null;
    var height = widgetHeight(this);
    updateLineHeight(line, Math.max(0, line.height - height));
    if (cm) runInOp(cm, function() {
      adjustScrollWhenAboveVisible(cm, line, -height);
      regLineChange(cm, no, "widget");
    });
  };
  LineWidget.prototype.changed = function() {
    var oldH = this.height, cm = this.doc.cm, line = this.line;
    this.height = null;
    var diff = widgetHeight(this) - oldH;
    if (!diff) return;
    updateLineHeight(line, line.height + diff);
    if (cm) runInOp(cm, function() {
      cm.curOp.forceUpdate = true;
      adjustScrollWhenAboveVisible(cm, line, diff);
    });
  };

  function widgetHeight(widget) {
    if (widget.height != null) return widget.height;
    var cm = widget.doc.cm;
    if (!cm) return 0;
    if (!contains(document.body, widget.node)) {
      var parentStyle = "position: relative;";
      if (widget.coverGutter)
        parentStyle += "margin-left: -" + cm.display.gutters.offsetWidth + "px;";
      if (widget.noHScroll)
        parentStyle += "width: " + cm.display.wrapper.clientWidth + "px;";
      removeChildrenAndAdd(cm.display.measure, elt("div", [widget.node], null, parentStyle));
    }
    return widget.height = widget.node.offsetHeight;
  }

  function addLineWidget(doc, handle, node, options) {
    var widget = new LineWidget(doc, node, options);
    var cm = doc.cm;
    if (cm && widget.noHScroll) cm.display.alignWidgets = true;
    changeLine(doc, handle, "widget", function(line) {
      var widgets = line.widgets || (line.widgets = []);
      if (widget.insertAt == null) widgets.push(widget);
      else widgets.splice(Math.min(widgets.length - 1, Math.max(0, widget.insertAt)), 0, widget);
      widget.line = line;
      if (cm && !lineIsHidden(doc, line)) {
        var aboveVisible = heightAtLine(line) < doc.scrollTop;
        updateLineHeight(line, line.height + widgetHeight(widget));
        if (aboveVisible) addToScrollPos(cm, null, widget.height);
        cm.curOp.forceUpdate = true;
      }
      return true;
    });
    return widget;
  }

  // LINE DATA STRUCTURE

  // Line objects. These hold state related to a line, including
  // highlighting info (the styles array).
  var Line = CodeMirror.Line = function(text, markedSpans, estimateHeight) {
    this.text = text;
    attachMarkedSpans(this, markedSpans);
    this.height = estimateHeight ? estimateHeight(this) : 1;
  };
  eventMixin(Line);
  Line.prototype.lineNo = function() { return lineNo(this); };

  // Change the content (text, markers) of a line. Automatically
  // invalidates cached information and tries to re-estimate the
  // line's height.
  function updateLine(line, text, markedSpans, estimateHeight) {
    line.text = text;
    if (line.stateAfter) line.stateAfter = null;
    if (line.styles) line.styles = null;
    if (line.order != null) line.order = null;
    detachMarkedSpans(line);
    attachMarkedSpans(line, markedSpans);
    var estHeight = estimateHeight ? estimateHeight(line) : 1;
    if (estHeight != line.height) updateLineHeight(line, estHeight);
  }

  // Detach a line from the document tree and its markers.
  function cleanUpLine(line) {
    line.parent = null;
    detachMarkedSpans(line);
  }

  function extractLineClasses(type, output) {
    if (type) for (;;) {
      var lineClass = type.match(/(?:^|\s+)line-(background-)?(\S+)/);
      if (!lineClass) break;
      type = type.slice(0, lineClass.index) + type.slice(lineClass.index + lineClass[0].length);
      var prop = lineClass[1] ? "bgClass" : "textClass";
      if (output[prop] == null)
        output[prop] = lineClass[2];
      else if (!(new RegExp("(?:^|\s)" + lineClass[2] + "(?:$|\s)")).test(output[prop]))
        output[prop] += " " + lineClass[2];
    }
    return type;
  }

  function callBlankLine(mode, state) {
    if (mode.blankLine) return mode.blankLine(state);
    if (!mode.innerMode) return;
    var inner = CodeMirror.innerMode(mode, state);
    if (inner.mode.blankLine) return inner.mode.blankLine(inner.state);
  }

  function readToken(mode, stream, state, inner) {
    for (var i = 0; i < 10; i++) {
      if (inner) inner[0] = CodeMirror.innerMode(mode, state).mode;
      var style = mode.token(stream, state);
      if (stream.pos > stream.start) return style;
    }
    throw new Error("Mode " + mode.name + " failed to advance stream.");
  }

  // Utility for getTokenAt and getLineTokens
  function takeToken(cm, pos, precise, asArray) {
    function getObj(copy) {
      return {start: stream.start, end: stream.pos,
              string: stream.current(),
              type: style || null,
              state: copy ? copyState(doc.mode, state) : state};
    }

    var doc = cm.doc, mode = doc.mode, style;
    pos = clipPos(doc, pos);
    var line = getLine(doc, pos.line), state = getStateBefore(cm, pos.line, precise);
    var stream = new StringStream(line.text, cm.options.tabSize), tokens;
    if (asArray) tokens = [];
    while ((asArray || stream.pos < pos.ch) && !stream.eol()) {
      stream.start = stream.pos;
      style = readToken(mode, stream, state);
      if (asArray) tokens.push(getObj(true));
    }
    return asArray ? tokens : getObj();
  }

  // Run the given mode's parser over a line, calling f for each token.
  function runMode(cm, text, mode, state, f, lineClasses, forceToEnd) {
    var flattenSpans = mode.flattenSpans;
    if (flattenSpans == null) flattenSpans = cm.options.flattenSpans;
    var curStart = 0, curStyle = null;
    var stream = new StringStream(text, cm.options.tabSize), style;
    var inner = cm.options.addModeClass && [null];
    if (text == "") extractLineClasses(callBlankLine(mode, state), lineClasses);
    while (!stream.eol()) {
      if (stream.pos > cm.options.maxHighlightLength) {
        flattenSpans = false;
        if (forceToEnd) processLine(cm, text, state, stream.pos);
        stream.pos = text.length;
        style = null;
      } else {
        style = extractLineClasses(readToken(mode, stream, state, inner), lineClasses);
      }
      if (inner) {
        var mName = inner[0].name;
        if (mName) style = "m-" + (style ? mName + " " + style : mName);
      }
      if (!flattenSpans || curStyle != style) {
        while (curStart < stream.start) {
          curStart = Math.min(stream.start, curStart + 50000);
          f(curStart, curStyle);
        }
        curStyle = style;
      }
      stream.start = stream.pos;
    }
    while (curStart < stream.pos) {
      // Webkit seems to refuse to render text nodes longer than 57444 characters
      var pos = Math.min(stream.pos, curStart + 50000);
      f(pos, curStyle);
      curStart = pos;
    }
  }

  // Compute a style array (an array starting with a mode generation
  // -- for invalidation -- followed by pairs of end positions and
  // style strings), which is used to highlight the tokens on the
  // line.
  function highlightLine(cm, line, state, forceToEnd) {
    // A styles array always starts with a number identifying the
    // mode/overlays that it is based on (for easy invalidation).
    var st = [cm.state.modeGen], lineClasses = {};
    // Compute the base array of styles
    runMode(cm, line.text, cm.doc.mode, state, function(end, style) {
      st.push(end, style);
    }, lineClasses, forceToEnd);

    // Run overlays, adjust style array.
    for (var o = 0; o < cm.state.overlays.length; ++o) {
      var overlay = cm.state.overlays[o], i = 1, at = 0;
      runMode(cm, line.text, overlay.mode, true, function(end, style) {
        var start = i;
        // Ensure there's a token end at the current position, and that i points at it
        while (at < end) {
          var i_end = st[i];
          if (i_end > end)
            st.splice(i, 1, end, st[i+1], i_end);
          i += 2;
          at = Math.min(end, i_end);
        }
        if (!style) return;
        if (overlay.opaque) {
          st.splice(start, i - start, end, "cm-overlay " + style);
          i = start + 2;
        } else {
          for (; start < i; start += 2) {
            var cur = st[start+1];
            st[start+1] = (cur ? cur + " " : "") + "cm-overlay " + style;
          }
        }
      }, lineClasses);
    }

    return {styles: st, classes: lineClasses.bgClass || lineClasses.textClass ? lineClasses : null};
  }

  function getLineStyles(cm, line, updateFrontier) {
    if (!line.styles || line.styles[0] != cm.state.modeGen) {
      var state = getStateBefore(cm, lineNo(line));
      var result = highlightLine(cm, line, line.text.length > cm.options.maxHighlightLength ? copyState(cm.doc.mode, state) : state);
      line.stateAfter = state;
      line.styles = result.styles;
      if (result.classes) line.styleClasses = result.classes;
      else if (line.styleClasses) line.styleClasses = null;
      if (updateFrontier === cm.doc.frontier) cm.doc.frontier++;
    }
    return line.styles;
  }

  // Lightweight form of highlight -- proceed over this line and
  // update state, but don't save a style array. Used for lines that
  // aren't currently visible.
  function processLine(cm, text, state, startAt) {
    var mode = cm.doc.mode;
    var stream = new StringStream(text, cm.options.tabSize);
    stream.start = stream.pos = startAt || 0;
    if (text == "") callBlankLine(mode, state);
    while (!stream.eol()) {
      readToken(mode, stream, state);
      stream.start = stream.pos;
    }
  }

  // Convert a style as returned by a mode (either null, or a string
  // containing one or more styles) to a CSS style. This is cached,
  // and also looks for line-wide styles.
  var styleToClassCache = {}, styleToClassCacheWithMode = {};
  function interpretTokenStyle(style, options) {
    if (!style || /^\s*$/.test(style)) return null;
    var cache = options.addModeClass ? styleToClassCacheWithMode : styleToClassCache;
    return cache[style] ||
      (cache[style] = style.replace(/\S+/g, "cm-$&"));
  }

  // Render the DOM representation of the text of a line. Also builds
  // up a 'line map', which points at the DOM nodes that represent
  // specific stretches of text, and is used by the measuring code.
  // The returned object contains the DOM node, this map, and
  // information about line-wide styles that were set by the mode.
  function buildLineContent(cm, lineView) {
    // The padding-right forces the element to have a 'border', which
    // is needed on Webkit to be able to get line-level bounding
    // rectangles for it (in measureChar).
    var content = elt("span", null, null, webkit ? "padding-right: .1px" : null);
    var builder = {pre: elt("pre", [content], "CodeMirror-line"), content: content,
                   col: 0, pos: 0, cm: cm,
                   splitSpaces: (ie || webkit) && cm.getOption("lineWrapping")};
    lineView.measure = {};

    // Iterate over the logical lines that make up this visual line.
    for (var i = 0; i <= (lineView.rest ? lineView.rest.length : 0); i++) {
      var line = i ? lineView.rest[i - 1] : lineView.line, order;
      builder.pos = 0;
      builder.addToken = buildToken;
      // Optionally wire in some hacks into the token-rendering
      // algorithm, to deal with browser quirks.
      if (hasBadBidiRects(cm.display.measure) && (order = getOrder(line)))
        builder.addToken = buildTokenBadBidi(builder.addToken, order);
      builder.map = [];
      var allowFrontierUpdate = lineView != cm.display.externalMeasured && lineNo(line);
      insertLineContent(line, builder, getLineStyles(cm, line, allowFrontierUpdate));
      if (line.styleClasses) {
        if (line.styleClasses.bgClass)
          builder.bgClass = joinClasses(line.styleClasses.bgClass, builder.bgClass || "");
        if (line.styleClasses.textClass)
          builder.textClass = joinClasses(line.styleClasses.textClass, builder.textClass || "");
      }

      // Ensure at least a single node is present, for measuring.
      if (builder.map.length == 0)
        builder.map.push(0, 0, builder.content.appendChild(zeroWidthElement(cm.display.measure)));

      // Store the map and a cache object for the current logical line
      if (i == 0) {
        lineView.measure.map = builder.map;
        lineView.measure.cache = {};
      } else {
        (lineView.measure.maps || (lineView.measure.maps = [])).push(builder.map);
        (lineView.measure.caches || (lineView.measure.caches = [])).push({});
      }
    }

    // See issue #2901
    if (webkit && /\bcm-tab\b/.test(builder.content.lastChild.className))
      builder.content.className = "cm-tab-wrap-hack";

    signal(cm, "renderLine", cm, lineView.line, builder.pre);
    if (builder.pre.className)
      builder.textClass = joinClasses(builder.pre.className, builder.textClass || "");

    return builder;
  }

  function defaultSpecialCharPlaceholder(ch) {
    var token = elt("span", "\u2022", "cm-invalidchar");
    token.title = "\\u" + ch.charCodeAt(0).toString(16);
    token.setAttribute("aria-label", token.title);
    return token;
  }

  // Build up the DOM representation for a single token, and add it to
  // the line map. Takes care to render special characters separately.
  function buildToken(builder, text, style, startStyle, endStyle, title, css) {
    if (!text) return;
    var displayText = builder.splitSpaces ? text.replace(/ {3,}/g, splitSpaces) : text;
    var special = builder.cm.state.specialChars, mustWrap = false;
    if (!special.test(text)) {
      builder.col += text.length;
      var content = document.createTextNode(displayText);
      builder.map.push(builder.pos, builder.pos + text.length, content);
      if (ie && ie_version < 9) mustWrap = true;
      builder.pos += text.length;
    } else {
      var content = document.createDocumentFragment(), pos = 0;
      while (true) {
        special.lastIndex = pos;
        var m = special.exec(text);
        var skipped = m ? m.index - pos : text.length - pos;
        if (skipped) {
          var txt = document.createTextNode(displayText.slice(pos, pos + skipped));
          if (ie && ie_version < 9) content.appendChild(elt("span", [txt]));
          else content.appendChild(txt);
          builder.map.push(builder.pos, builder.pos + skipped, txt);
          builder.col += skipped;
          builder.pos += skipped;
        }
        if (!m) break;
        pos += skipped + 1;
        if (m[0] == "\t") {
          var tabSize = builder.cm.options.tabSize, tabWidth = tabSize - builder.col % tabSize;
          var txt = content.appendChild(elt("span", spaceStr(tabWidth), "cm-tab"));
          txt.setAttribute("role", "presentation");
          txt.setAttribute("cm-text", "\t");
          builder.col += tabWidth;
        } else if (m[0] == "\r" || m[0] == "\n") {
          var txt = content.appendChild(elt("span", m[0] == "\r" ? "\u240d" : "\u2424", "cm-invalidchar"));
          txt.setAttribute("cm-text", m[0]);
          builder.col += 1;
        } else {
          var txt = builder.cm.options.specialCharPlaceholder(m[0]);
          txt.setAttribute("cm-text", m[0]);
          if (ie && ie_version < 9) content.appendChild(elt("span", [txt]));
          else content.appendChild(txt);
          builder.col += 1;
        }
        builder.map.push(builder.pos, builder.pos + 1, txt);
        builder.pos++;
      }
    }
    if (style || startStyle || endStyle || mustWrap || css) {
      var fullStyle = style || "";
      if (startStyle) fullStyle += startStyle;
      if (endStyle) fullStyle += endStyle;
      var token = elt("span", [content], fullStyle, css);
      if (title) token.title = title;
      return builder.content.appendChild(token);
    }
    builder.content.appendChild(content);
  }

  function splitSpaces(old) {
    var out = " ";
    for (var i = 0; i < old.length - 2; ++i) out += i % 2 ? " " : "\u00a0";
    out += " ";
    return out;
  }

  // Work around nonsense dimensions being reported for stretches of
  // right-to-left text.
  function buildTokenBadBidi(inner, order) {
    return function(builder, text, style, startStyle, endStyle, title, css) {
      style = style ? style + " cm-force-border" : "cm-force-border";
      var start = builder.pos, end = start + text.length;
      for (;;) {
        // Find the part that overlaps with the start of this text
        for (var i = 0; i < order.length; i++) {
          var part = order[i];
          if (part.to > start && part.from <= start) break;
        }
        if (part.to >= end) return inner(builder, text, style, startStyle, endStyle, title, css);
        inner(builder, text.slice(0, part.to - start), style, startStyle, null, title, css);
        startStyle = null;
        text = text.slice(part.to - start);
        start = part.to;
      }
    };
  }

  function buildCollapsedSpan(builder, size, marker, ignoreWidget) {
    var widget = !ignoreWidget && marker.widgetNode;
    if (widget) builder.map.push(builder.pos, builder.pos + size, widget);
    if (!ignoreWidget && builder.cm.display.input.needsContentAttribute) {
      if (!widget)
        widget = builder.content.appendChild(document.createElement("span"));
      widget.setAttribute("cm-marker", marker.id);
    }
    if (widget) {
      builder.cm.display.input.setUneditable(widget);
      builder.content.appendChild(widget);
    }
    builder.pos += size;
  }

  // Outputs a number of spans to make up a line, taking highlighting
  // and marked text into account.
  function insertLineContent(line, builder, styles) {
    var spans = line.markedSpans, allText = line.text, at = 0;
    if (!spans) {
      for (var i = 1; i < styles.length; i+=2)
        builder.addToken(builder, allText.slice(at, at = styles[i]), interpretTokenStyle(styles[i+1], builder.cm.options));
      return;
    }

    var len = allText.length, pos = 0, i = 1, text = "", style, css;
    var nextChange = 0, spanStyle, spanEndStyle, spanStartStyle, title, collapsed;
    for (;;) {
      if (nextChange == pos) { // Update current marker set
        spanStyle = spanEndStyle = spanStartStyle = title = css = "";
        collapsed = null; nextChange = Infinity;
        var foundBookmarks = [];
        for (var j = 0; j < spans.length; ++j) {
          var sp = spans[j], m = sp.marker;
          if (m.type == "bookmark" && sp.from == pos && m.widgetNode) {
            foundBookmarks.push(m);
          } else if (sp.from <= pos && (sp.to == null || sp.to > pos || m.collapsed && sp.to == pos && sp.from == pos)) {
            if (sp.to != null && sp.to != pos && nextChange > sp.to) {
              nextChange = sp.to;
              spanEndStyle = "";
            }
            if (m.className) spanStyle += " " + m.className;
            if (m.css) css = m.css;
            if (m.startStyle && sp.from == pos) spanStartStyle += " " + m.startStyle;
            if (m.endStyle && sp.to == nextChange) spanEndStyle += " " + m.endStyle;
            if (m.title && !title) title = m.title;
            if (m.collapsed && (!collapsed || compareCollapsedMarkers(collapsed.marker, m) < 0))
              collapsed = sp;
          } else if (sp.from > pos && nextChange > sp.from) {
            nextChange = sp.from;
          }
        }
        if (collapsed && (collapsed.from || 0) == pos) {
          buildCollapsedSpan(builder, (collapsed.to == null ? len + 1 : collapsed.to) - pos,
                             collapsed.marker, collapsed.from == null);
          if (collapsed.to == null) return;
          if (collapsed.to == pos) collapsed = false;
        }
        if (!collapsed && foundBookmarks.length) for (var j = 0; j < foundBookmarks.length; ++j)
          buildCollapsedSpan(builder, 0, foundBookmarks[j]);
      }
      if (pos >= len) break;

      var upto = Math.min(len, nextChange);
      while (true) {
        if (text) {
          var end = pos + text.length;
          if (!collapsed) {
            var tokenText = end > upto ? text.slice(0, upto - pos) : text;
            builder.addToken(builder, tokenText, style ? style + spanStyle : spanStyle,
                             spanStartStyle, pos + tokenText.length == nextChange ? spanEndStyle : "", title, css);
          }
          if (end >= upto) {text = text.slice(upto - pos); pos = upto; break;}
          pos = end;
          spanStartStyle = "";
        }
        text = allText.slice(at, at = styles[i++]);
        style = interpretTokenStyle(styles[i++], builder.cm.options);
      }
    }
  }

  // DOCUMENT DATA STRUCTURE

  // By default, updates that start and end at the beginning of a line
  // are treated specially, in order to make the association of line
  // widgets and marker elements with the text behave more intuitive.
  function isWholeLineUpdate(doc, change) {
    return change.from.ch == 0 && change.to.ch == 0 && lst(change.text) == "" &&
      (!doc.cm || doc.cm.options.wholeLineUpdateBefore);
  }

  // Perform a change on the document data structure.
  function updateDoc(doc, change, markedSpans, estimateHeight) {
    function spansFor(n) {return markedSpans ? markedSpans[n] : null;}
    function update(line, text, spans) {
      updateLine(line, text, spans, estimateHeight);
      signalLater(line, "change", line, change);
    }
    function linesFor(start, end) {
      for (var i = start, result = []; i < end; ++i)
        result.push(new Line(text[i], spansFor(i), estimateHeight));
      return result;
    }

    var from = change.from, to = change.to, text = change.text;
    var firstLine = getLine(doc, from.line), lastLine = getLine(doc, to.line);
    var lastText = lst(text), lastSpans = spansFor(text.length - 1), nlines = to.line - from.line;

    // Adjust the line structure
    if (change.full) {
      doc.insert(0, linesFor(0, text.length));
      doc.remove(text.length, doc.size - text.length);
    } else if (isWholeLineUpdate(doc, change)) {
      // This is a whole-line replace. Treated specially to make
      // sure line objects move the way they are supposed to.
      var added = linesFor(0, text.length - 1);
      update(lastLine, lastLine.text, lastSpans);
      if (nlines) doc.remove(from.line, nlines);
      if (added.length) doc.insert(from.line, added);
    } else if (firstLine == lastLine) {
      if (text.length == 1) {
        update(firstLine, firstLine.text.slice(0, from.ch) + lastText + firstLine.text.slice(to.ch), lastSpans);
      } else {
        var added = linesFor(1, text.length - 1);
        added.push(new Line(lastText + firstLine.text.slice(to.ch), lastSpans, estimateHeight));
        update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
        doc.insert(from.line + 1, added);
      }
    } else if (text.length == 1) {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0] + lastLine.text.slice(to.ch), spansFor(0));
      doc.remove(from.line + 1, nlines);
    } else {
      update(firstLine, firstLine.text.slice(0, from.ch) + text[0], spansFor(0));
      update(lastLine, lastText + lastLine.text.slice(to.ch), lastSpans);
      var added = linesFor(1, text.length - 1);
      if (nlines > 1) doc.remove(from.line + 1, nlines - 1);
      doc.insert(from.line + 1, added);
    }

    signalLater(doc, "change", doc, change);
  }

  // The document is represented as a BTree consisting of leaves, with
  // chunk of lines in them, and branches, with up to ten leaves or
  // other branch nodes below them. The top node is always a branch
  // node, and is the document object itself (meaning it has
  // additional methods and properties).
  //
  // All nodes have parent links. The tree is used both to go from
  // line numbers to line objects, and to go from objects to numbers.
  // It also indexes by height, and is used to convert between height
  // and line object, and to find the total height of the document.
  //
  // See also http://marijnhaverbeke.nl/blog/codemirror-line-tree.html

  function LeafChunk(lines) {
    this.lines = lines;
    this.parent = null;
    for (var i = 0, height = 0; i < lines.length; ++i) {
      lines[i].parent = this;
      height += lines[i].height;
    }
    this.height = height;
  }

  LeafChunk.prototype = {
    chunkSize: function() { return this.lines.length; },
    // Remove the n lines at offset 'at'.
    removeInner: function(at, n) {
      for (var i = at, e = at + n; i < e; ++i) {
        var line = this.lines[i];
        this.height -= line.height;
        cleanUpLine(line);
        signalLater(line, "delete");
      }
      this.lines.splice(at, n);
    },
    // Helper used to collapse a small branch into a single leaf.
    collapse: function(lines) {
      lines.push.apply(lines, this.lines);
    },
    // Insert the given array of lines at offset 'at', count them as
    // having the given height.
    insertInner: function(at, lines, height) {
      this.height += height;
      this.lines = this.lines.slice(0, at).concat(lines).concat(this.lines.slice(at));
      for (var i = 0; i < lines.length; ++i) lines[i].parent = this;
    },
    // Used to iterate over a part of the tree.
    iterN: function(at, n, op) {
      for (var e = at + n; at < e; ++at)
        if (op(this.lines[at])) return true;
    }
  };

  function BranchChunk(children) {
    this.children = children;
    var size = 0, height = 0;
    for (var i = 0; i < children.length; ++i) {
      var ch = children[i];
      size += ch.chunkSize(); height += ch.height;
      ch.parent = this;
    }
    this.size = size;
    this.height = height;
    this.parent = null;
  }

  BranchChunk.prototype = {
    chunkSize: function() { return this.size; },
    removeInner: function(at, n) {
      this.size -= n;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var rm = Math.min(n, sz - at), oldHeight = child.height;
          child.removeInner(at, rm);
          this.height -= oldHeight - child.height;
          if (sz == rm) { this.children.splice(i--, 1); child.parent = null; }
          if ((n -= rm) == 0) break;
          at = 0;
        } else at -= sz;
      }
      // If the result is smaller than 25 lines, ensure that it is a
      // single leaf node.
      if (this.size - n < 25 &&
          (this.children.length > 1 || !(this.children[0] instanceof LeafChunk))) {
        var lines = [];
        this.collapse(lines);
        this.children = [new LeafChunk(lines)];
        this.children[0].parent = this;
      }
    },
    collapse: function(lines) {
      for (var i = 0; i < this.children.length; ++i) this.children[i].collapse(lines);
    },
    insertInner: function(at, lines, height) {
      this.size += lines.length;
      this.height += height;
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at <= sz) {
          child.insertInner(at, lines, height);
          if (child.lines && child.lines.length > 50) {
            while (child.lines.length > 50) {
              var spilled = child.lines.splice(child.lines.length - 25, 25);
              var newleaf = new LeafChunk(spilled);
              child.height -= newleaf.height;
              this.children.splice(i + 1, 0, newleaf);
              newleaf.parent = this;
            }
            this.maybeSpill();
          }
          break;
        }
        at -= sz;
      }
    },
    // When a node has grown, check whether it should be split.
    maybeSpill: function() {
      if (this.children.length <= 10) return;
      var me = this;
      do {
        var spilled = me.children.splice(me.children.length - 5, 5);
        var sibling = new BranchChunk(spilled);
        if (!me.parent) { // Become the parent node
          var copy = new BranchChunk(me.children);
          copy.parent = me;
          me.children = [copy, sibling];
          me = copy;
        } else {
          me.size -= sibling.size;
          me.height -= sibling.height;
          var myIndex = indexOf(me.parent.children, me);
          me.parent.children.splice(myIndex + 1, 0, sibling);
        }
        sibling.parent = me.parent;
      } while (me.children.length > 10);
      me.parent.maybeSpill();
    },
    iterN: function(at, n, op) {
      for (var i = 0; i < this.children.length; ++i) {
        var child = this.children[i], sz = child.chunkSize();
        if (at < sz) {
          var used = Math.min(n, sz - at);
          if (child.iterN(at, used, op)) return true;
          if ((n -= used) == 0) break;
          at = 0;
        } else at -= sz;
      }
    }
  };

  var nextDocId = 0;
  var Doc = CodeMirror.Doc = function(text, mode, firstLine, lineSep) {
    if (!(this instanceof Doc)) return new Doc(text, mode, firstLine, lineSep);
    if (firstLine == null) firstLine = 0;

    BranchChunk.call(this, [new LeafChunk([new Line("", null)])]);
    this.first = firstLine;
    this.scrollTop = this.scrollLeft = 0;
    this.cantEdit = false;
    this.cleanGeneration = 1;
    this.frontier = firstLine;
    var start = Pos(firstLine, 0);
    this.sel = simpleSelection(start);
    this.history = new History(null);
    this.id = ++nextDocId;
    this.modeOption = mode;
    this.lineSep = lineSep;

    if (typeof text == "string") text = this.splitLines(text);
    updateDoc(this, {from: start, to: start, text: text});
    setSelection(this, simpleSelection(start), sel_dontScroll);
  };

  Doc.prototype = createObj(BranchChunk.prototype, {
    constructor: Doc,
    // Iterate over the document. Supports two forms -- with only one
    // argument, it calls that for each line in the document. With
    // three, it iterates over the range given by the first two (with
    // the second being non-inclusive).
    iter: function(from, to, op) {
      if (op) this.iterN(from - this.first, to - from, op);
      else this.iterN(this.first, this.first + this.size, from);
    },

    // Non-public interface for adding and removing lines.
    insert: function(at, lines) {
      var height = 0;
      for (var i = 0; i < lines.length; ++i) height += lines[i].height;
      this.insertInner(at - this.first, lines, height);
    },
    remove: function(at, n) { this.removeInner(at - this.first, n); },

    // From here, the methods are part of the public interface. Most
    // are also available from CodeMirror (editor) instances.

    getValue: function(lineSep) {
      var lines = getLines(this, this.first, this.first + this.size);
      if (lineSep === false) return lines;
      return lines.join(lineSep || this.lineSeparator());
    },
    setValue: docMethodOp(function(code) {
      var top = Pos(this.first, 0), last = this.first + this.size - 1;
      makeChange(this, {from: top, to: Pos(last, getLine(this, last).text.length),
                        text: this.splitLines(code), origin: "setValue", full: true}, true);
      setSelection(this, simpleSelection(top));
    }),
    replaceRange: function(code, from, to, origin) {
      from = clipPos(this, from);
      to = to ? clipPos(this, to) : from;
      replaceRange(this, code, from, to, origin);
    },
    getRange: function(from, to, lineSep) {
      var lines = getBetween(this, clipPos(this, from), clipPos(this, to));
      if (lineSep === false) return lines;
      return lines.join(lineSep || this.lineSeparator());
    },

    getLine: function(line) {var l = this.getLineHandle(line); return l && l.text;},

    getLineHandle: function(line) {if (isLine(this, line)) return getLine(this, line);},
    getLineNumber: function(line) {return lineNo(line);},

    getLineHandleVisualStart: function(line) {
      if (typeof line == "number") line = getLine(this, line);
      return visualLine(line);
    },

    lineCount: function() {return this.size;},
    firstLine: function() {return this.first;},
    lastLine: function() {return this.first + this.size - 1;},

    clipPos: function(pos) {return clipPos(this, pos);},

    getCursor: function(start) {
      var range = this.sel.primary(), pos;
      if (start == null || start == "head") pos = range.head;
      else if (start == "anchor") pos = range.anchor;
      else if (start == "end" || start == "to" || start === false) pos = range.to();
      else pos = range.from();
      return pos;
    },
    listSelections: function() { return this.sel.ranges; },
    somethingSelected: function() {return this.sel.somethingSelected();},

    setCursor: docMethodOp(function(line, ch, options) {
      setSimpleSelection(this, clipPos(this, typeof line == "number" ? Pos(line, ch || 0) : line), null, options);
    }),
    setSelection: docMethodOp(function(anchor, head, options) {
      setSimpleSelection(this, clipPos(this, anchor), clipPos(this, head || anchor), options);
    }),
    extendSelection: docMethodOp(function(head, other, options) {
      extendSelection(this, clipPos(this, head), other && clipPos(this, other), options);
    }),
    extendSelections: docMethodOp(function(heads, options) {
      extendSelections(this, clipPosArray(this, heads, options));
    }),
    extendSelectionsBy: docMethodOp(function(f, options) {
      extendSelections(this, map(this.sel.ranges, f), options);
    }),
    setSelections: docMethodOp(function(ranges, primary, options) {
      if (!ranges.length) return;
      for (var i = 0, out = []; i < ranges.length; i++)
        out[i] = new Range(clipPos(this, ranges[i].anchor),
                           clipPos(this, ranges[i].head));
      if (primary == null) primary = Math.min(ranges.length - 1, this.sel.primIndex);
      setSelection(this, normalizeSelection(out, primary), options);
    }),
    addSelection: docMethodOp(function(anchor, head, options) {
      var ranges = this.sel.ranges.slice(0);
      ranges.push(new Range(clipPos(this, anchor), clipPos(this, head || anchor)));
      setSelection(this, normalizeSelection(ranges, ranges.length - 1), options);
    }),

    getSelection: function(lineSep) {
      var ranges = this.sel.ranges, lines;
      for (var i = 0; i < ranges.length; i++) {
        var sel = getBetween(this, ranges[i].from(), ranges[i].to());
        lines = lines ? lines.concat(sel) : sel;
      }
      if (lineSep === false) return lines;
      else return lines.join(lineSep || this.lineSeparator());
    },
    getSelections: function(lineSep) {
      var parts = [], ranges = this.sel.ranges;
      for (var i = 0; i < ranges.length; i++) {
        var sel = getBetween(this, ranges[i].from(), ranges[i].to());
        if (lineSep !== false) sel = sel.join(lineSep || this.lineSeparator());
        parts[i] = sel;
      }
      return parts;
    },
    replaceSelection: function(code, collapse, origin) {
      var dup = [];
      for (var i = 0; i < this.sel.ranges.length; i++)
        dup[i] = code;
      this.replaceSelections(dup, collapse, origin || "+input");
    },
    replaceSelections: docMethodOp(function(code, collapse, origin) {
      var changes = [], sel = this.sel;
      for (var i = 0; i < sel.ranges.length; i++) {
        var range = sel.ranges[i];
        changes[i] = {from: range.from(), to: range.to(), text: this.splitLines(code[i]), origin: origin};
      }
      var newSel = collapse && collapse != "end" && computeReplacedSel(this, changes, collapse);
      for (var i = changes.length - 1; i >= 0; i--)
        makeChange(this, changes[i]);
      if (newSel) setSelectionReplaceHistory(this, newSel);
      else if (this.cm) ensureCursorVisible(this.cm);
    }),
    undo: docMethodOp(function() {makeChangeFromHistory(this, "undo");}),
    redo: docMethodOp(function() {makeChangeFromHistory(this, "redo");}),
    undoSelection: docMethodOp(function() {makeChangeFromHistory(this, "undo", true);}),
    redoSelection: docMethodOp(function() {makeChangeFromHistory(this, "redo", true);}),

    setExtending: function(val) {this.extend = val;},
    getExtending: function() {return this.extend;},

    historySize: function() {
      var hist = this.history, done = 0, undone = 0;
      for (var i = 0; i < hist.done.length; i++) if (!hist.done[i].ranges) ++done;
      for (var i = 0; i < hist.undone.length; i++) if (!hist.undone[i].ranges) ++undone;
      return {undo: done, redo: undone};
    },
    clearHistory: function() {this.history = new History(this.history.maxGeneration);},

    markClean: function() {
      this.cleanGeneration = this.changeGeneration(true);
    },
    changeGeneration: function(forceSplit) {
      if (forceSplit)
        this.history.lastOp = this.history.lastSelOp = this.history.lastOrigin = null;
      return this.history.generation;
    },
    isClean: function (gen) {
      return this.history.generation == (gen || this.cleanGeneration);
    },

    getHistory: function() {
      return {done: copyHistoryArray(this.history.done),
              undone: copyHistoryArray(this.history.undone)};
    },
    setHistory: function(histData) {
      var hist = this.history = new History(this.history.maxGeneration);
      hist.done = copyHistoryArray(histData.done.slice(0), null, true);
      hist.undone = copyHistoryArray(histData.undone.slice(0), null, true);
    },

    addLineClass: docMethodOp(function(handle, where, cls) {
      return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function(line) {
        var prop = where == "text" ? "textClass"
                 : where == "background" ? "bgClass"
                 : where == "gutter" ? "gutterClass" : "wrapClass";
        if (!line[prop]) line[prop] = cls;
        else if (classTest(cls).test(line[prop])) return false;
        else line[prop] += " " + cls;
        return true;
      });
    }),
    removeLineClass: docMethodOp(function(handle, where, cls) {
      return changeLine(this, handle, where == "gutter" ? "gutter" : "class", function(line) {
        var prop = where == "text" ? "textClass"
                 : where == "background" ? "bgClass"
                 : where == "gutter" ? "gutterClass" : "wrapClass";
        var cur = line[prop];
        if (!cur) return false;
        else if (cls == null) line[prop] = null;
        else {
          var found = cur.match(classTest(cls));
          if (!found) return false;
          var end = found.index + found[0].length;
          line[prop] = cur.slice(0, found.index) + (!found.index || end == cur.length ? "" : " ") + cur.slice(end) || null;
        }
        return true;
      });
    }),

    addLineWidget: docMethodOp(function(handle, node, options) {
      return addLineWidget(this, handle, node, options);
    }),
    removeLineWidget: function(widget) { widget.clear(); },

    markText: function(from, to, options) {
      return markText(this, clipPos(this, from), clipPos(this, to), options, options && options.type || "range");
    },
    setBookmark: function(pos, options) {
      var realOpts = {replacedWith: options && (options.nodeType == null ? options.widget : options),
                      insertLeft: options && options.insertLeft,
                      clearWhenEmpty: false, shared: options && options.shared,
                      handleMouseEvents: options && options.handleMouseEvents};
      pos = clipPos(this, pos);
      return markText(this, pos, pos, realOpts, "bookmark");
    },
    findMarksAt: function(pos) {
      pos = clipPos(this, pos);
      var markers = [], spans = getLine(this, pos.line).markedSpans;
      if (spans) for (var i = 0; i < spans.length; ++i) {
        var span = spans[i];
        if ((span.from == null || span.from <= pos.ch) &&
            (span.to == null || span.to >= pos.ch))
          markers.push(span.marker.parent || span.marker);
      }
      return markers;
    },
    findMarks: function(from, to, filter) {
      from = clipPos(this, from); to = clipPos(this, to);
      var found = [], lineNo = from.line;
      this.iter(from.line, to.line + 1, function(line) {
        var spans = line.markedSpans;
        if (spans) for (var i = 0; i < spans.length; i++) {
          var span = spans[i];
          if (!(lineNo == from.line && from.ch > span.to ||
                span.from == null && lineNo != from.line||
                lineNo == to.line && span.from > to.ch) &&
              (!filter || filter(span.marker)))
            found.push(span.marker.parent || span.marker);
        }
        ++lineNo;
      });
      return found;
    },
    getAllMarks: function() {
      var markers = [];
      this.iter(function(line) {
        var sps = line.markedSpans;
        if (sps) for (var i = 0; i < sps.length; ++i)
          if (sps[i].from != null) markers.push(sps[i].marker);
      });
      return markers;
    },

    posFromIndex: function(off) {
      var ch, lineNo = this.first;
      this.iter(function(line) {
        var sz = line.text.length + 1;
        if (sz > off) { ch = off; return true; }
        off -= sz;
        ++lineNo;
      });
      return clipPos(this, Pos(lineNo, ch));
    },
    indexFromPos: function (coords) {
      coords = clipPos(this, coords);
      var index = coords.ch;
      if (coords.line < this.first || coords.ch < 0) return 0;
      this.iter(this.first, coords.line, function (line) {
        index += line.text.length + 1;
      });
      return index;
    },

    copy: function(copyHistory) {
      var doc = new Doc(getLines(this, this.first, this.first + this.size),
                        this.modeOption, this.first, this.lineSep);
      doc.scrollTop = this.scrollTop; doc.scrollLeft = this.scrollLeft;
      doc.sel = this.sel;
      doc.extend = false;
      if (copyHistory) {
        doc.history.undoDepth = this.history.undoDepth;
        doc.setHistory(this.getHistory());
      }
      return doc;
    },

    linkedDoc: function(options) {
      if (!options) options = {};
      var from = this.first, to = this.first + this.size;
      if (options.from != null && options.from > from) from = options.from;
      if (options.to != null && options.to < to) to = options.to;
      var copy = new Doc(getLines(this, from, to), options.mode || this.modeOption, from, this.lineSep);
      if (options.sharedHist) copy.history = this.history;
      (this.linked || (this.linked = [])).push({doc: copy, sharedHist: options.sharedHist});
      copy.linked = [{doc: this, isParent: true, sharedHist: options.sharedHist}];
      copySharedMarkers(copy, findSharedMarkers(this));
      return copy;
    },
    unlinkDoc: function(other) {
      if (other instanceof CodeMirror) other = other.doc;
      if (this.linked) for (var i = 0; i < this.linked.length; ++i) {
        var link = this.linked[i];
        if (link.doc != other) continue;
        this.linked.splice(i, 1);
        other.unlinkDoc(this);
        detachSharedMarkers(findSharedMarkers(this));
        break;
      }
      // If the histories were shared, split them again
      if (other.history == this.history) {
        var splitIds = [other.id];
        linkedDocs(other, function(doc) {splitIds.push(doc.id);}, true);
        other.history = new History(null);
        other.history.done = copyHistoryArray(this.history.done, splitIds);
        other.history.undone = copyHistoryArray(this.history.undone, splitIds);
      }
    },
    iterLinkedDocs: function(f) {linkedDocs(this, f);},

    getMode: function() {return this.mode;},
    getEditor: function() {return this.cm;},

    splitLines: function(str) {
      if (this.lineSep) return str.split(this.lineSep);
      return splitLinesAuto(str);
    },
    lineSeparator: function() { return this.lineSep || "\n"; }
  });

  // Public alias.
  Doc.prototype.eachLine = Doc.prototype.iter;

  // Set up methods on CodeMirror's prototype to redirect to the editor's document.
  var dontDelegate = "iter insert remove copy getEditor constructor".split(" ");
  for (var prop in Doc.prototype) if (Doc.prototype.hasOwnProperty(prop) && indexOf(dontDelegate, prop) < 0)
    CodeMirror.prototype[prop] = (function(method) {
      return function() {return method.apply(this.doc, arguments);};
    })(Doc.prototype[prop]);

  eventMixin(Doc);

  // Call f for all linked documents.
  function linkedDocs(doc, f, sharedHistOnly) {
    function propagate(doc, skip, sharedHist) {
      if (doc.linked) for (var i = 0; i < doc.linked.length; ++i) {
        var rel = doc.linked[i];
        if (rel.doc == skip) continue;
        var shared = sharedHist && rel.sharedHist;
        if (sharedHistOnly && !shared) continue;
        f(rel.doc, shared);
        propagate(rel.doc, doc, shared);
      }
    }
    propagate(doc, null, true);
  }

  // Attach a document to an editor.
  function attachDoc(cm, doc) {
    if (doc.cm) throw new Error("This document is already in use.");
    cm.doc = doc;
    doc.cm = cm;
    estimateLineHeights(cm);
    loadMode(cm);
    if (!cm.options.lineWrapping) findMaxLine(cm);
    cm.options.mode = doc.modeOption;
    regChange(cm);
  }

  // LINE UTILITIES

  // Find the line object corresponding to the given line number.
  function getLine(doc, n) {
    n -= doc.first;
    if (n < 0 || n >= doc.size) throw new Error("There is no line " + (n + doc.first) + " in the document.");
    for (var chunk = doc; !chunk.lines;) {
      for (var i = 0;; ++i) {
        var child = chunk.children[i], sz = child.chunkSize();
        if (n < sz) { chunk = child; break; }
        n -= sz;
      }
    }
    return chunk.lines[n];
  }

  // Get the part of a document between two positions, as an array of
  // strings.
  function getBetween(doc, start, end) {
    var out = [], n = start.line;
    doc.iter(start.line, end.line + 1, function(line) {
      var text = line.text;
      if (n == end.line) text = text.slice(0, end.ch);
      if (n == start.line) text = text.slice(start.ch);
      out.push(text);
      ++n;
    });
    return out;
  }
  // Get the lines between from and to, as array of strings.
  function getLines(doc, from, to) {
    var out = [];
    doc.iter(from, to, function(line) { out.push(line.text); });
    return out;
  }

  // Update the height of a line, propagating the height change
  // upwards to parent nodes.
  function updateLineHeight(line, height) {
    var diff = height - line.height;
    if (diff) for (var n = line; n; n = n.parent) n.height += diff;
  }

  // Given a line object, find its line number by walking up through
  // its parent links.
  function lineNo(line) {
    if (line.parent == null) return null;
    var cur = line.parent, no = indexOf(cur.lines, line);
    for (var chunk = cur.parent; chunk; cur = chunk, chunk = chunk.parent) {
      for (var i = 0;; ++i) {
        if (chunk.children[i] == cur) break;
        no += chunk.children[i].chunkSize();
      }
    }
    return no + cur.first;
  }

  // Find the line at the given vertical position, using the height
  // information in the document tree.
  function lineAtHeight(chunk, h) {
    var n = chunk.first;
    outer: do {
      for (var i = 0; i < chunk.children.length; ++i) {
        var child = chunk.children[i], ch = child.height;
        if (h < ch) { chunk = child; continue outer; }
        h -= ch;
        n += child.chunkSize();
      }
      return n;
    } while (!chunk.lines);
    for (var i = 0; i < chunk.lines.length; ++i) {
      var line = chunk.lines[i], lh = line.height;
      if (h < lh) break;
      h -= lh;
    }
    return n + i;
  }


  // Find the height above the given line.
  function heightAtLine(lineObj) {
    lineObj = visualLine(lineObj);

    var h = 0, chunk = lineObj.parent;
    for (var i = 0; i < chunk.lines.length; ++i) {
      var line = chunk.lines[i];
      if (line == lineObj) break;
      else h += line.height;
    }
    for (var p = chunk.parent; p; chunk = p, p = chunk.parent) {
      for (var i = 0; i < p.children.length; ++i) {
        var cur = p.children[i];
        if (cur == chunk) break;
        else h += cur.height;
      }
    }
    return h;
  }

  // Get the bidi ordering for the given line (and cache it). Returns
  // false for lines that are fully left-to-right, and an array of
  // BidiSpan objects otherwise.
  function getOrder(line) {
    var order = line.order;
    if (order == null) order = line.order = bidiOrdering(line.text);
    return order;
  }

  // HISTORY

  function History(startGen) {
    // Arrays of change events and selections. Doing something adds an
    // event to done and clears undo. Undoing moves events from done
    // to undone, redoing moves them in the other direction.
    this.done = []; this.undone = [];
    this.undoDepth = Infinity;
    // Used to track when changes can be merged into a single undo
    // event
    this.lastModTime = this.lastSelTime = 0;
    this.lastOp = this.lastSelOp = null;
    this.lastOrigin = this.lastSelOrigin = null;
    // Used by the isClean() method
    this.generation = this.maxGeneration = startGen || 1;
  }

  // Create a history change event from an updateDoc-style change
  // object.
  function historyChangeFromChange(doc, change) {
    var histChange = {from: copyPos(change.from), to: changeEnd(change), text: getBetween(doc, change.from, change.to)};
    attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);
    linkedDocs(doc, function(doc) {attachLocalSpans(doc, histChange, change.from.line, change.to.line + 1);}, true);
    return histChange;
  }

  // Pop all selection events off the end of a history array. Stop at
  // a change event.
  function clearSelectionEvents(array) {
    while (array.length) {
      var last = lst(array);
      if (last.ranges) array.pop();
      else break;
    }
  }

  // Find the top change event in the history. Pop off selection
  // events that are in the way.
  function lastChangeEvent(hist, force) {
    if (force) {
      clearSelectionEvents(hist.done);
      return lst(hist.done);
    } else if (hist.done.length && !lst(hist.done).ranges) {
      return lst(hist.done);
    } else if (hist.done.length > 1 && !hist.done[hist.done.length - 2].ranges) {
      hist.done.pop();
      return lst(hist.done);
    }
  }

  // Register a change in the history. Merges changes that are within
  // a single operation, ore are close together with an origin that
  // allows merging (starting with "+") into a single event.
  function addChangeToHistory(doc, change, selAfter, opId) {
    var hist = doc.history;
    hist.undone.length = 0;
    var time = +new Date, cur;

    if ((hist.lastOp == opId ||
         hist.lastOrigin == change.origin && change.origin &&
         ((change.origin.charAt(0) == "+" && doc.cm && hist.lastModTime > time - doc.cm.options.historyEventDelay) ||
          change.origin.charAt(0) == "*")) &&
        (cur = lastChangeEvent(hist, hist.lastOp == opId))) {
      // Merge this change into the last event
      var last = lst(cur.changes);
      if (cmp(change.from, change.to) == 0 && cmp(change.from, last.to) == 0) {
        // Optimized case for simple insertion -- don't want to add
        // new changesets for every character typed
        last.to = changeEnd(change);
      } else {
        // Add new sub-event
        cur.changes.push(historyChangeFromChange(doc, change));
      }
    } else {
      // Can not be merged, start a new event.
      var before = lst(hist.done);
      if (!before || !before.ranges)
        pushSelectionToHistory(doc.sel, hist.done);
      cur = {changes: [historyChangeFromChange(doc, change)],
             generation: hist.generation};
      hist.done.push(cur);
      while (hist.done.length > hist.undoDepth) {
        hist.done.shift();
        if (!hist.done[0].ranges) hist.done.shift();
      }
    }
    hist.done.push(selAfter);
    hist.generation = ++hist.maxGeneration;
    hist.lastModTime = hist.lastSelTime = time;
    hist.lastOp = hist.lastSelOp = opId;
    hist.lastOrigin = hist.lastSelOrigin = change.origin;

    if (!last) signal(doc, "historyAdded");
  }

  function selectionEventCanBeMerged(doc, origin, prev, sel) {
    var ch = origin.charAt(0);
    return ch == "*" ||
      ch == "+" &&
      prev.ranges.length == sel.ranges.length &&
      prev.somethingSelected() == sel.somethingSelected() &&
      new Date - doc.history.lastSelTime <= (doc.cm ? doc.cm.options.historyEventDelay : 500);
  }

  // Called whenever the selection changes, sets the new selection as
  // the pending selection in the history, and pushes the old pending
  // selection into the 'done' array when it was significantly
  // different (in number of selected ranges, emptiness, or time).
  function addSelectionToHistory(doc, sel, opId, options) {
    var hist = doc.history, origin = options && options.origin;

    // A new event is started when the previous origin does not match
    // the current, or the origins don't allow matching. Origins
    // starting with * are always merged, those starting with + are
    // merged when similar and close together in time.
    if (opId == hist.lastSelOp ||
        (origin && hist.lastSelOrigin == origin &&
         (hist.lastModTime == hist.lastSelTime && hist.lastOrigin == origin ||
          selectionEventCanBeMerged(doc, origin, lst(hist.done), sel))))
      hist.done[hist.done.length - 1] = sel;
    else
      pushSelectionToHistory(sel, hist.done);

    hist.lastSelTime = +new Date;
    hist.lastSelOrigin = origin;
    hist.lastSelOp = opId;
    if (options && options.clearRedo !== false)
      clearSelectionEvents(hist.undone);
  }

  function pushSelectionToHistory(sel, dest) {
    var top = lst(dest);
    if (!(top && top.ranges && top.equals(sel)))
      dest.push(sel);
  }

  // Used to store marked span information in the history.
  function attachLocalSpans(doc, change, from, to) {
    var existing = change["spans_" + doc.id], n = 0;
    doc.iter(Math.max(doc.first, from), Math.min(doc.first + doc.size, to), function(line) {
      if (line.markedSpans)
        (existing || (existing = change["spans_" + doc.id] = {}))[n] = line.markedSpans;
      ++n;
    });
  }

  // When un/re-doing restores text containing marked spans, those
  // that have been explicitly cleared should not be restored.
  function removeClearedSpans(spans) {
    if (!spans) return null;
    for (var i = 0, out; i < spans.length; ++i) {
      if (spans[i].marker.explicitlyCleared) { if (!out) out = spans.slice(0, i); }
      else if (out) out.push(spans[i]);
    }
    return !out ? spans : out.length ? out : null;
  }

  // Retrieve and filter the old marked spans stored in a change event.
  function getOldSpans(doc, change) {
    var found = change["spans_" + doc.id];
    if (!found) return null;
    for (var i = 0, nw = []; i < change.text.length; ++i)
      nw.push(removeClearedSpans(found[i]));
    return nw;
  }

  // Used both to provide a JSON-safe object in .getHistory, and, when
  // detaching a document, to split the history in two
  function copyHistoryArray(events, newGroup, instantiateSel) {
    for (var i = 0, copy = []; i < events.length; ++i) {
      var event = events[i];
      if (event.ranges) {
        copy.push(instantiateSel ? Selection.prototype.deepCopy.call(event) : event);
        continue;
      }
      var changes = event.changes, newChanges = [];
      copy.push({changes: newChanges});
      for (var j = 0; j < changes.length; ++j) {
        var change = changes[j], m;
        newChanges.push({from: change.from, to: change.to, text: change.text});
        if (newGroup) for (var prop in change) if (m = prop.match(/^spans_(\d+)$/)) {
          if (indexOf(newGroup, Number(m[1])) > -1) {
            lst(newChanges)[prop] = change[prop];
            delete change[prop];
          }
        }
      }
    }
    return copy;
  }

  // Rebasing/resetting history to deal with externally-sourced changes

  function rebaseHistSelSingle(pos, from, to, diff) {
    if (to < pos.line) {
      pos.line += diff;
    } else if (from < pos.line) {
      pos.line = from;
      pos.ch = 0;
    }
  }

  // Tries to rebase an array of history events given a change in the
  // document. If the change touches the same lines as the event, the
  // event, and everything 'behind' it, is discarded. If the change is
  // before the event, the event's positions are updated. Uses a
  // copy-on-write scheme for the positions, to avoid having to
  // reallocate them all on every rebase, but also avoid problems with
  // shared position objects being unsafely updated.
  function rebaseHistArray(array, from, to, diff) {
    for (var i = 0; i < array.length; ++i) {
      var sub = array[i], ok = true;
      if (sub.ranges) {
        if (!sub.copied) { sub = array[i] = sub.deepCopy(); sub.copied = true; }
        for (var j = 0; j < sub.ranges.length; j++) {
          rebaseHistSelSingle(sub.ranges[j].anchor, from, to, diff);
          rebaseHistSelSingle(sub.ranges[j].head, from, to, diff);
        }
        continue;
      }
      for (var j = 0; j < sub.changes.length; ++j) {
        var cur = sub.changes[j];
        if (to < cur.from.line) {
          cur.from = Pos(cur.from.line + diff, cur.from.ch);
          cur.to = Pos(cur.to.line + diff, cur.to.ch);
        } else if (from <= cur.to.line) {
          ok = false;
          break;
        }
      }
      if (!ok) {
        array.splice(0, i + 1);
        i = 0;
      }
    }
  }

  function rebaseHist(hist, change) {
    var from = change.from.line, to = change.to.line, diff = change.text.length - (to - from) - 1;
    rebaseHistArray(hist.done, from, to, diff);
    rebaseHistArray(hist.undone, from, to, diff);
  }

  // EVENT UTILITIES

  // Due to the fact that we still support jurassic IE versions, some
  // compatibility wrappers are needed.

  var e_preventDefault = CodeMirror.e_preventDefault = function(e) {
    if (e.preventDefault) e.preventDefault();
    else e.returnValue = false;
  };
  var e_stopPropagation = CodeMirror.e_stopPropagation = function(e) {
    if (e.stopPropagation) e.stopPropagation();
    else e.cancelBubble = true;
  };
  function e_defaultPrevented(e) {
    return e.defaultPrevented != null ? e.defaultPrevented : e.returnValue == false;
  }
  var e_stop = CodeMirror.e_stop = function(e) {e_preventDefault(e); e_stopPropagation(e);};

  function e_target(e) {return e.target || e.srcElement;}
  function e_button(e) {
    var b = e.which;
    if (b == null) {
      if (e.button & 1) b = 1;
      else if (e.button & 2) b = 3;
      else if (e.button & 4) b = 2;
    }
    if (mac && e.ctrlKey && b == 1) b = 3;
    return b;
  }

  // EVENT HANDLING

  // Lightweight event framework. on/off also work on DOM nodes,
  // registering native DOM handlers.

  var on = CodeMirror.on = function(emitter, type, f) {
    if (emitter.addEventListener)
      emitter.addEventListener(type, f, false);
    else if (emitter.attachEvent)
      emitter.attachEvent("on" + type, f);
    else {
      var map = emitter._handlers || (emitter._handlers = {});
      var arr = map[type] || (map[type] = []);
      arr.push(f);
    }
  };

  var noHandlers = []
  function getHandlers(emitter, type, copy) {
    var arr = emitter._handlers && emitter._handlers[type]
    if (copy) return arr && arr.length > 0 ? arr.slice() : noHandlers
    else return arr || noHandlers
  }

  var off = CodeMirror.off = function(emitter, type, f) {
    if (emitter.removeEventListener)
      emitter.removeEventListener(type, f, false);
    else if (emitter.detachEvent)
      emitter.detachEvent("on" + type, f);
    else {
      var handlers = getHandlers(emitter, type, false)
      for (var i = 0; i < handlers.length; ++i)
        if (handlers[i] == f) { handlers.splice(i, 1); break; }
    }
  };

  var signal = CodeMirror.signal = function(emitter, type /*, values...*/) {
    var handlers = getHandlers(emitter, type, true)
    if (!handlers.length) return;
    var args = Array.prototype.slice.call(arguments, 2);
    for (var i = 0; i < handlers.length; ++i) handlers[i].apply(null, args);
  };

  var orphanDelayedCallbacks = null;

  // Often, we want to signal events at a point where we are in the
  // middle of some work, but don't want the handler to start calling
  // other methods on the editor, which might be in an inconsistent
  // state or simply not expect any other events to happen.
  // signalLater looks whether there are any handlers, and schedules
  // them to be executed when the last operation ends, or, if no
  // operation is active, when a timeout fires.
  function signalLater(emitter, type /*, values...*/) {
    var arr = getHandlers(emitter, type, false)
    if (!arr.length) return;
    var args = Array.prototype.slice.call(arguments, 2), list;
    if (operationGroup) {
      list = operationGroup.delayedCallbacks;
    } else if (orphanDelayedCallbacks) {
      list = orphanDelayedCallbacks;
    } else {
      list = orphanDelayedCallbacks = [];
      setTimeout(fireOrphanDelayed, 0);
    }
    function bnd(f) {return function(){f.apply(null, args);};};
    for (var i = 0; i < arr.length; ++i)
      list.push(bnd(arr[i]));
  }

  function fireOrphanDelayed() {
    var delayed = orphanDelayedCallbacks;
    orphanDelayedCallbacks = null;
    for (var i = 0; i < delayed.length; ++i) delayed[i]();
  }

  // The DOM events that CodeMirror handles can be overridden by
  // registering a (non-DOM) handler on the editor for the event name,
  // and preventDefault-ing the event in that handler.
  function signalDOMEvent(cm, e, override) {
    if (typeof e == "string")
      e = {type: e, preventDefault: function() { this.defaultPrevented = true; }};
    signal(cm, override || e.type, cm, e);
    return e_defaultPrevented(e) || e.codemirrorIgnore;
  }

  function signalCursorActivity(cm) {
    var arr = cm._handlers && cm._handlers.cursorActivity;
    if (!arr) return;
    var set = cm.curOp.cursorActivityHandlers || (cm.curOp.cursorActivityHandlers = []);
    for (var i = 0; i < arr.length; ++i) if (indexOf(set, arr[i]) == -1)
      set.push(arr[i]);
  }

  function hasHandler(emitter, type) {
    return getHandlers(emitter, type).length > 0
  }

  // Add on and off methods to a constructor's prototype, to make
  // registering events on such objects more convenient.
  function eventMixin(ctor) {
    ctor.prototype.on = function(type, f) {on(this, type, f);};
    ctor.prototype.off = function(type, f) {off(this, type, f);};
  }

  // MISC UTILITIES

  // Number of pixels added to scroller and sizer to hide scrollbar
  var scrollerGap = 30;

  // Returned or thrown by various protocols to signal 'I'm not
  // handling this'.
  var Pass = CodeMirror.Pass = {toString: function(){return "CodeMirror.Pass";}};

  // Reused option objects for setSelection & friends
  var sel_dontScroll = {scroll: false}, sel_mouse = {origin: "*mouse"}, sel_move = {origin: "+move"};

  function Delayed() {this.id = null;}
  Delayed.prototype.set = function(ms, f) {
    clearTimeout(this.id);
    this.id = setTimeout(f, ms);
  };

  // Counts the column offset in a string, taking tabs into account.
  // Used mostly to find indentation.
  var countColumn = CodeMirror.countColumn = function(string, end, tabSize, startIndex, startValue) {
    if (end == null) {
      end = string.search(/[^\s\u00a0]/);
      if (end == -1) end = string.length;
    }
    for (var i = startIndex || 0, n = startValue || 0;;) {
      var nextTab = string.indexOf("\t", i);
      if (nextTab < 0 || nextTab >= end)
        return n + (end - i);
      n += nextTab - i;
      n += tabSize - (n % tabSize);
      i = nextTab + 1;
    }
  };

  // The inverse of countColumn -- find the offset that corresponds to
  // a particular column.
  var findColumn = CodeMirror.findColumn = function(string, goal, tabSize) {
    for (var pos = 0, col = 0;;) {
      var nextTab = string.indexOf("\t", pos);
      if (nextTab == -1) nextTab = string.length;
      var skipped = nextTab - pos;
      if (nextTab == string.length || col + skipped >= goal)
        return pos + Math.min(skipped, goal - col);
      col += nextTab - pos;
      col += tabSize - (col % tabSize);
      pos = nextTab + 1;
      if (col >= goal) return pos;
    }
  }

  var spaceStrs = [""];
  function spaceStr(n) {
    while (spaceStrs.length <= n)
      spaceStrs.push(lst(spaceStrs) + " ");
    return spaceStrs[n];
  }

  function lst(arr) { return arr[arr.length-1]; }

  var selectInput = function(node) { node.select(); };
  if (ios) // Mobile Safari apparently has a bug where select() is broken.
    selectInput = function(node) { node.selectionStart = 0; node.selectionEnd = node.value.length; };
  else if (ie) // Suppress mysterious IE10 errors
    selectInput = function(node) { try { node.select(); } catch(_e) {} };

  function indexOf(array, elt) {
    for (var i = 0; i < array.length; ++i)
      if (array[i] == elt) return i;
    return -1;
  }
  function map(array, f) {
    var out = [];
    for (var i = 0; i < array.length; i++) out[i] = f(array[i], i);
    return out;
  }

  function nothing() {}

  function createObj(base, props) {
    var inst;
    if (Object.create) {
      inst = Object.create(base);
    } else {
      nothing.prototype = base;
      inst = new nothing();
    }
    if (props) copyObj(props, inst);
    return inst;
  };

  function copyObj(obj, target, overwrite) {
    if (!target) target = {};
    for (var prop in obj)
      if (obj.hasOwnProperty(prop) && (overwrite !== false || !target.hasOwnProperty(prop)))
        target[prop] = obj[prop];
    return target;
  }

  function bind(f) {
    var args = Array.prototype.slice.call(arguments, 1);
    return function(){return f.apply(null, args);};
  }

  var nonASCIISingleCaseWordChar = /[\u00df\u0587\u0590-\u05f4\u0600-\u06ff\u3040-\u309f\u30a0-\u30ff\u3400-\u4db5\u4e00-\u9fcc\uac00-\ud7af]/;
  var isWordCharBasic = CodeMirror.isWordChar = function(ch) {
    return /\w/.test(ch) || ch > "\x80" &&
      (ch.toUpperCase() != ch.toLowerCase() || nonASCIISingleCaseWordChar.test(ch));
  };
  function isWordChar(ch, helper) {
    if (!helper) return isWordCharBasic(ch);
    if (helper.source.indexOf("\\w") > -1 && isWordCharBasic(ch)) return true;
    return helper.test(ch);
  }

  function isEmpty(obj) {
    for (var n in obj) if (obj.hasOwnProperty(n) && obj[n]) return false;
    return true;
  }

  // Extending unicode characters. A series of a non-extending char +
  // any number of extending chars is treated as a single unit as far
  // as editing and measuring is concerned. This is not fully correct,
  // since some scripts/fonts/browsers also treat other configurations
  // of code points as a group.
  var extendingChars = /[\u0300-\u036f\u0483-\u0489\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7\u0610-\u061a\u064b-\u065e\u0670\u06d6-\u06dc\u06de-\u06e4\u06e7\u06e8\u06ea-\u06ed\u0711\u0730-\u074a\u07a6-\u07b0\u07eb-\u07f3\u0816-\u0819\u081b-\u0823\u0825-\u0827\u0829-\u082d\u0900-\u0902\u093c\u0941-\u0948\u094d\u0951-\u0955\u0962\u0963\u0981\u09bc\u09be\u09c1-\u09c4\u09cd\u09d7\u09e2\u09e3\u0a01\u0a02\u0a3c\u0a41\u0a42\u0a47\u0a48\u0a4b-\u0a4d\u0a51\u0a70\u0a71\u0a75\u0a81\u0a82\u0abc\u0ac1-\u0ac5\u0ac7\u0ac8\u0acd\u0ae2\u0ae3\u0b01\u0b3c\u0b3e\u0b3f\u0b41-\u0b44\u0b4d\u0b56\u0b57\u0b62\u0b63\u0b82\u0bbe\u0bc0\u0bcd\u0bd7\u0c3e-\u0c40\u0c46-\u0c48\u0c4a-\u0c4d\u0c55\u0c56\u0c62\u0c63\u0cbc\u0cbf\u0cc2\u0cc6\u0ccc\u0ccd\u0cd5\u0cd6\u0ce2\u0ce3\u0d3e\u0d41-\u0d44\u0d4d\u0d57\u0d62\u0d63\u0dca\u0dcf\u0dd2-\u0dd4\u0dd6\u0ddf\u0e31\u0e34-\u0e3a\u0e47-\u0e4e\u0eb1\u0eb4-\u0eb9\u0ebb\u0ebc\u0ec8-\u0ecd\u0f18\u0f19\u0f35\u0f37\u0f39\u0f71-\u0f7e\u0f80-\u0f84\u0f86\u0f87\u0f90-\u0f97\u0f99-\u0fbc\u0fc6\u102d-\u1030\u1032-\u1037\u1039\u103a\u103d\u103e\u1058\u1059\u105e-\u1060\u1071-\u1074\u1082\u1085\u1086\u108d\u109d\u135f\u1712-\u1714\u1732-\u1734\u1752\u1753\u1772\u1773\u17b7-\u17bd\u17c6\u17c9-\u17d3\u17dd\u180b-\u180d\u18a9\u1920-\u1922\u1927\u1928\u1932\u1939-\u193b\u1a17\u1a18\u1a56\u1a58-\u1a5e\u1a60\u1a62\u1a65-\u1a6c\u1a73-\u1a7c\u1a7f\u1b00-\u1b03\u1b34\u1b36-\u1b3a\u1b3c\u1b42\u1b6b-\u1b73\u1b80\u1b81\u1ba2-\u1ba5\u1ba8\u1ba9\u1c2c-\u1c33\u1c36\u1c37\u1cd0-\u1cd2\u1cd4-\u1ce0\u1ce2-\u1ce8\u1ced\u1dc0-\u1de6\u1dfd-\u1dff\u200c\u200d\u20d0-\u20f0\u2cef-\u2cf1\u2de0-\u2dff\u302a-\u302f\u3099\u309a\ua66f-\ua672\ua67c\ua67d\ua6f0\ua6f1\ua802\ua806\ua80b\ua825\ua826\ua8c4\ua8e0-\ua8f1\ua926-\ua92d\ua947-\ua951\ua980-\ua982\ua9b3\ua9b6-\ua9b9\ua9bc\uaa29-\uaa2e\uaa31\uaa32\uaa35\uaa36\uaa43\uaa4c\uaab0\uaab2-\uaab4\uaab7\uaab8\uaabe\uaabf\uaac1\uabe5\uabe8\uabed\udc00-\udfff\ufb1e\ufe00-\ufe0f\ufe20-\ufe26\uff9e\uff9f]/;
  function isExtendingChar(ch) { return ch.charCodeAt(0) >= 768 && extendingChars.test(ch); }

  // DOM UTILITIES

  function elt(tag, content, className, style) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (style) e.style.cssText = style;
    if (typeof content == "string") e.appendChild(document.createTextNode(content));
    else if (content) for (var i = 0; i < content.length; ++i) e.appendChild(content[i]);
    return e;
  }

  var range;
  if (document.createRange) range = function(node, start, end, endNode) {
    var r = document.createRange();
    r.setEnd(endNode || node, end);
    r.setStart(node, start);
    return r;
  };
  else range = function(node, start, end) {
    var r = document.body.createTextRange();
    try { r.moveToElementText(node.parentNode); }
    catch(e) { return r; }
    r.collapse(true);
    r.moveEnd("character", end);
    r.moveStart("character", start);
    return r;
  };

  function removeChildren(e) {
    for (var count = e.childNodes.length; count > 0; --count)
      e.removeChild(e.firstChild);
    return e;
  }

  function removeChildrenAndAdd(parent, e) {
    return removeChildren(parent).appendChild(e);
  }

  var contains = CodeMirror.contains = function(parent, child) {
    if (child.nodeType == 3) // Android browser always returns false when child is a textnode
      child = child.parentNode;
    if (parent.contains)
      return parent.contains(child);
    do {
      if (child.nodeType == 11) child = child.host;
      if (child == parent) return true;
    } while (child = child.parentNode);
  };

  function activeElt() {
    var activeElement = document.activeElement;
    while (activeElement && activeElement.root && activeElement.root.activeElement)
      activeElement = activeElement.root.activeElement;
    return activeElement;
  }
  // Older versions of IE throws unspecified error when touching
  // document.activeElement in some cases (during loading, in iframe)
  if (ie && ie_version < 11) activeElt = function() {
    try { return document.activeElement; }
    catch(e) { return document.body; }
  };

  function classTest(cls) { return new RegExp("(^|\\s)" + cls + "(?:$|\\s)\\s*"); }
  var rmClass = CodeMirror.rmClass = function(node, cls) {
    var current = node.className;
    var match = classTest(cls).exec(current);
    if (match) {
      var after = current.slice(match.index + match[0].length);
      node.className = current.slice(0, match.index) + (after ? match[1] + after : "");
    }
  };
  var addClass = CodeMirror.addClass = function(node, cls) {
    var current = node.className;
    if (!classTest(cls).test(current)) node.className += (current ? " " : "") + cls;
  };
  function joinClasses(a, b) {
    var as = a.split(" ");
    for (var i = 0; i < as.length; i++)
      if (as[i] && !classTest(as[i]).test(b)) b += " " + as[i];
    return b;
  }

  // WINDOW-WIDE EVENTS

  // These must be handled carefully, because naively registering a
  // handler for each editor will cause the editors to never be
  // garbage collected.

  function forEachCodeMirror(f) {
    if (!document.body.getElementsByClassName) return;
    var byClass = document.body.getElementsByClassName("CodeMirror");
    for (var i = 0; i < byClass.length; i++) {
      var cm = byClass[i].CodeMirror;
      if (cm) f(cm);
    }
  }

  var globalsRegistered = false;
  function ensureGlobalHandlers() {
    if (globalsRegistered) return;
    registerGlobalHandlers();
    globalsRegistered = true;
  }
  function registerGlobalHandlers() {
    // When the window resizes, we need to refresh active editors.
    var resizeTimer;
    on(window, "resize", function() {
      if (resizeTimer == null) resizeTimer = setTimeout(function() {
        resizeTimer = null;
        forEachCodeMirror(onResize);
      }, 100);
    });
    // When the window loses focus, we want to show the editor as blurred
    on(window, "blur", function() {
      forEachCodeMirror(onBlur);
    });
  }

  // FEATURE DETECTION

  // Detect drag-and-drop
  var dragAndDrop = function() {
    // There is *some* kind of drag-and-drop support in IE6-8, but I
    // couldn't get it to work yet.
    if (ie && ie_version < 9) return false;
    var div = elt('div');
    return "draggable" in div || "dragDrop" in div;
  }();

  var zwspSupported;
  function zeroWidthElement(measure) {
    if (zwspSupported == null) {
      var test = elt("span", "\u200b");
      removeChildrenAndAdd(measure, elt("span", [test, document.createTextNode("x")]));
      if (measure.firstChild.offsetHeight != 0)
        zwspSupported = test.offsetWidth <= 1 && test.offsetHeight > 2 && !(ie && ie_version < 8);
    }
    var node = zwspSupported ? elt("span", "\u200b") :
      elt("span", "\u00a0", null, "display: inline-block; width: 1px; margin-right: -1px");
    node.setAttribute("cm-text", "");
    return node;
  }

  // Feature-detect IE's crummy client rect reporting for bidi text
  var badBidiRects;
  function hasBadBidiRects(measure) {
    if (badBidiRects != null) return badBidiRects;
    var txt = removeChildrenAndAdd(measure, document.createTextNode("A\u062eA"));
    var r0 = range(txt, 0, 1).getBoundingClientRect();
    if (!r0 || r0.left == r0.right) return false; // Safari returns null in some cases (#2780)
    var r1 = range(txt, 1, 2).getBoundingClientRect();
    return badBidiRects = (r1.right - r0.right < 3);
  }

  // See if "".split is the broken IE version, if so, provide an
  // alternative way to split lines.
  var splitLinesAuto = CodeMirror.splitLines = "\n\nb".split(/\n/).length != 3 ? function(string) {
    var pos = 0, result = [], l = string.length;
    while (pos <= l) {
      var nl = string.indexOf("\n", pos);
      if (nl == -1) nl = string.length;
      var line = string.slice(pos, string.charAt(nl - 1) == "\r" ? nl - 1 : nl);
      var rt = line.indexOf("\r");
      if (rt != -1) {
        result.push(line.slice(0, rt));
        pos += rt + 1;
      } else {
        result.push(line);
        pos = nl + 1;
      }
    }
    return result;
  } : function(string){return string.split(/\r\n?|\n/);};

  var hasSelection = window.getSelection ? function(te) {
    try { return te.selectionStart != te.selectionEnd; }
    catch(e) { return false; }
  } : function(te) {
    try {var range = te.ownerDocument.selection.createRange();}
    catch(e) {}
    if (!range || range.parentElement() != te) return false;
    return range.compareEndPoints("StartToEnd", range) != 0;
  };

  var hasCopyEvent = (function() {
    var e = elt("div");
    if ("oncopy" in e) return true;
    e.setAttribute("oncopy", "return;");
    return typeof e.oncopy == "function";
  })();

  var badZoomedRects = null;
  function hasBadZoomedRects(measure) {
    if (badZoomedRects != null) return badZoomedRects;
    var node = removeChildrenAndAdd(measure, elt("span", "x"));
    var normal = node.getBoundingClientRect();
    var fromRange = range(node, 0, 1).getBoundingClientRect();
    return badZoomedRects = Math.abs(normal.left - fromRange.left) > 1;
  }

  // KEY NAMES

  var keyNames = CodeMirror.keyNames = {
    3: "Enter", 8: "Backspace", 9: "Tab", 13: "Enter", 16: "Shift", 17: "Ctrl", 18: "Alt",
    19: "Pause", 20: "CapsLock", 27: "Esc", 32: "Space", 33: "PageUp", 34: "PageDown", 35: "End",
    36: "Home", 37: "Left", 38: "Up", 39: "Right", 40: "Down", 44: "PrintScrn", 45: "Insert",
    46: "Delete", 59: ";", 61: "=", 91: "Mod", 92: "Mod", 93: "Mod",
    106: "*", 107: "=", 109: "-", 110: ".", 111: "/", 127: "Delete",
    173: "-", 186: ";", 187: "=", 188: ",", 189: "-", 190: ".", 191: "/", 192: "`", 219: "[", 220: "\\",
    221: "]", 222: "'", 63232: "Up", 63233: "Down", 63234: "Left", 63235: "Right", 63272: "Delete",
    63273: "Home", 63275: "End", 63276: "PageUp", 63277: "PageDown", 63302: "Insert"
  };
  (function() {
    // Number keys
    for (var i = 0; i < 10; i++) keyNames[i + 48] = keyNames[i + 96] = String(i);
    // Alphabetic keys
    for (var i = 65; i <= 90; i++) keyNames[i] = String.fromCharCode(i);
    // Function keys
    for (var i = 1; i <= 12; i++) keyNames[i + 111] = keyNames[i + 63235] = "F" + i;
  })();

  // BIDI HELPERS

  function iterateBidiSections(order, from, to, f) {
    if (!order) return f(from, to, "ltr");
    var found = false;
    for (var i = 0; i < order.length; ++i) {
      var part = order[i];
      if (part.from < to && part.to > from || from == to && part.to == from) {
        f(Math.max(part.from, from), Math.min(part.to, to), part.level == 1 ? "rtl" : "ltr");
        found = true;
      }
    }
    if (!found) f(from, to, "ltr");
  }

  function bidiLeft(part) { return part.level % 2 ? part.to : part.from; }
  function bidiRight(part) { return part.level % 2 ? part.from : part.to; }

  function lineLeft(line) { var order = getOrder(line); return order ? bidiLeft(order[0]) : 0; }
  function lineRight(line) {
    var order = getOrder(line);
    if (!order) return line.text.length;
    return bidiRight(lst(order));
  }

  function lineStart(cm, lineN) {
    var line = getLine(cm.doc, lineN);
    var visual = visualLine(line);
    if (visual != line) lineN = lineNo(visual);
    var order = getOrder(visual);
    var ch = !order ? 0 : order[0].level % 2 ? lineRight(visual) : lineLeft(visual);
    return Pos(lineN, ch);
  }
  function lineEnd(cm, lineN) {
    var merged, line = getLine(cm.doc, lineN);
    while (merged = collapsedSpanAtEnd(line)) {
      line = merged.find(1, true).line;
      lineN = null;
    }
    var order = getOrder(line);
    var ch = !order ? line.text.length : order[0].level % 2 ? lineLeft(line) : lineRight(line);
    return Pos(lineN == null ? lineNo(line) : lineN, ch);
  }
  function lineStartSmart(cm, pos) {
    var start = lineStart(cm, pos.line);
    var line = getLine(cm.doc, start.line);
    var order = getOrder(line);
    if (!order || order[0].level == 0) {
      var firstNonWS = Math.max(0, line.text.search(/\S/));
      var inWS = pos.line == start.line && pos.ch <= firstNonWS && pos.ch;
      return Pos(start.line, inWS ? 0 : firstNonWS);
    }
    return start;
  }

  function compareBidiLevel(order, a, b) {
    var linedir = order[0].level;
    if (a == linedir) return true;
    if (b == linedir) return false;
    return a < b;
  }
  var bidiOther;
  function getBidiPartAt(order, pos) {
    bidiOther = null;
    for (var i = 0, found; i < order.length; ++i) {
      var cur = order[i];
      if (cur.from < pos && cur.to > pos) return i;
      if ((cur.from == pos || cur.to == pos)) {
        if (found == null) {
          found = i;
        } else if (compareBidiLevel(order, cur.level, order[found].level)) {
          if (cur.from != cur.to) bidiOther = found;
          return i;
        } else {
          if (cur.from != cur.to) bidiOther = i;
          return found;
        }
      }
    }
    return found;
  }

  function moveInLine(line, pos, dir, byUnit) {
    if (!byUnit) return pos + dir;
    do pos += dir;
    while (pos > 0 && isExtendingChar(line.text.charAt(pos)));
    return pos;
  }

  // This is needed in order to move 'visually' through bi-directional
  // text -- i.e., pressing left should make the cursor go left, even
  // when in RTL text. The tricky part is the 'jumps', where RTL and
  // LTR text touch each other. This often requires the cursor offset
  // to move more than one unit, in order to visually move one unit.
  function moveVisually(line, start, dir, byUnit) {
    var bidi = getOrder(line);
    if (!bidi) return moveLogically(line, start, dir, byUnit);
    var pos = getBidiPartAt(bidi, start), part = bidi[pos];
    var target = moveInLine(line, start, part.level % 2 ? -dir : dir, byUnit);

    for (;;) {
      if (target > part.from && target < part.to) return target;
      if (target == part.from || target == part.to) {
        if (getBidiPartAt(bidi, target) == pos) return target;
        part = bidi[pos += dir];
        return (dir > 0) == part.level % 2 ? part.to : part.from;
      } else {
        part = bidi[pos += dir];
        if (!part) return null;
        if ((dir > 0) == part.level % 2)
          target = moveInLine(line, part.to, -1, byUnit);
        else
          target = moveInLine(line, part.from, 1, byUnit);
      }
    }
  }

  function moveLogically(line, start, dir, byUnit) {
    var target = start + dir;
    if (byUnit) while (target > 0 && isExtendingChar(line.text.charAt(target))) target += dir;
    return target < 0 || target > line.text.length ? null : target;
  }

  // Bidirectional ordering algorithm
  // See http://unicode.org/reports/tr9/tr9-13.html for the algorithm
  // that this (partially) implements.

  // One-char codes used for character types:
  // L (L):   Left-to-Right
  // R (R):   Right-to-Left
  // r (AL):  Right-to-Left Arabic
  // 1 (EN):  European Number
  // + (ES):  European Number Separator
  // % (ET):  European Number Terminator
  // n (AN):  Arabic Number
  // , (CS):  Common Number Separator
  // m (NSM): Non-Spacing Mark
  // b (BN):  Boundary Neutral
  // s (B):   Paragraph Separator
  // t (S):   Segment Separator
  // w (WS):  Whitespace
  // N (ON):  Other Neutrals

  // Returns null if characters are ordered as they appear
  // (left-to-right), or an array of sections ({from, to, level}
  // objects) in the order in which they occur visually.
  var bidiOrdering = (function() {
    // Character types for codepoints 0 to 0xff
    var lowTypes = "bbbbbbbbbtstwsbbbbbbbbbbbbbbssstwNN%%%NNNNNN,N,N1111111111NNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNNNLLLLLLLLLLLLLLLLLLLLLLLLLLNNNNbbbbbbsbbbbbbbbbbbbbbbbbbbbbbbbbb,N%%%%NNNNLNNNNN%%11NLNNN1LNNNNNLLLLLLLLLLLLLLLLLLLLLLLNLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLN";
    // Character types for codepoints 0x600 to 0x6ff
    var arabicTypes = "rrrrrrrrrrrr,rNNmmmmmmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmrrrrrrrnnnnnnnnnn%nnrrrmrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrrmmmmmmmmmmmmmmmmmmmNmmmm";
    function charType(code) {
      if (code <= 0xf7) return lowTypes.charAt(code);
      else if (0x590 <= code && code <= 0x5f4) return "R";
      else if (0x600 <= code && code <= 0x6ed) return arabicTypes.charAt(code - 0x600);
      else if (0x6ee <= code && code <= 0x8ac) return "r";
      else if (0x2000 <= code && code <= 0x200b) return "w";
      else if (code == 0x200c) return "b";
      else return "L";
    }

    var bidiRE = /[\u0590-\u05f4\u0600-\u06ff\u0700-\u08ac]/;
    var isNeutral = /[stwN]/, isStrong = /[LRr]/, countsAsLeft = /[Lb1n]/, countsAsNum = /[1n]/;
    // Browsers seem to always treat the boundaries of block elements as being L.
    var outerType = "L";

    function BidiSpan(level, from, to) {
      this.level = level;
      this.from = from; this.to = to;
    }

    return function(str) {
      if (!bidiRE.test(str)) return false;
      var len = str.length, types = [];
      for (var i = 0, type; i < len; ++i)
        types.push(type = charType(str.charCodeAt(i)));

      // W1. Examine each non-spacing mark (NSM) in the level run, and
      // change the type of the NSM to the type of the previous
      // character. If the NSM is at the start of the level run, it will
      // get the type of sor.
      for (var i = 0, prev = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "m") types[i] = prev;
        else prev = type;
      }

      // W2. Search backwards from each instance of a European number
      // until the first strong type (R, L, AL, or sor) is found. If an
      // AL is found, change the type of the European number to Arabic
      // number.
      // W3. Change all ALs to R.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (type == "1" && cur == "r") types[i] = "n";
        else if (isStrong.test(type)) { cur = type; if (type == "r") types[i] = "R"; }
      }

      // W4. A single European separator between two European numbers
      // changes to a European number. A single common separator between
      // two numbers of the same type changes to that type.
      for (var i = 1, prev = types[0]; i < len - 1; ++i) {
        var type = types[i];
        if (type == "+" && prev == "1" && types[i+1] == "1") types[i] = "1";
        else if (type == "," && prev == types[i+1] &&
                 (prev == "1" || prev == "n")) types[i] = prev;
        prev = type;
      }

      // W5. A sequence of European terminators adjacent to European
      // numbers changes to all European numbers.
      // W6. Otherwise, separators and terminators change to Other
      // Neutral.
      for (var i = 0; i < len; ++i) {
        var type = types[i];
        if (type == ",") types[i] = "N";
        else if (type == "%") {
          for (var end = i + 1; end < len && types[end] == "%"; ++end) {}
          var replace = (i && types[i-1] == "!") || (end < len && types[end] == "1") ? "1" : "N";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // W7. Search backwards from each instance of a European number
      // until the first strong type (R, L, or sor) is found. If an L is
      // found, then change the type of the European number to L.
      for (var i = 0, cur = outerType; i < len; ++i) {
        var type = types[i];
        if (cur == "L" && type == "1") types[i] = "L";
        else if (isStrong.test(type)) cur = type;
      }

      // N1. A sequence of neutrals takes the direction of the
      // surrounding strong text if the text on both sides has the same
      // direction. European and Arabic numbers act as if they were R in
      // terms of their influence on neutrals. Start-of-level-run (sor)
      // and end-of-level-run (eor) are used at level run boundaries.
      // N2. Any remaining neutrals take the embedding direction.
      for (var i = 0; i < len; ++i) {
        if (isNeutral.test(types[i])) {
          for (var end = i + 1; end < len && isNeutral.test(types[end]); ++end) {}
          var before = (i ? types[i-1] : outerType) == "L";
          var after = (end < len ? types[end] : outerType) == "L";
          var replace = before || after ? "L" : "R";
          for (var j = i; j < end; ++j) types[j] = replace;
          i = end - 1;
        }
      }

      // Here we depart from the documented algorithm, in order to avoid
      // building up an actual levels array. Since there are only three
      // levels (0, 1, 2) in an implementation that doesn't take
      // explicit embedding into account, we can build up the order on
      // the fly, without following the level-based algorithm.
      var order = [], m;
      for (var i = 0; i < len;) {
        if (countsAsLeft.test(types[i])) {
          var start = i;
          for (++i; i < len && countsAsLeft.test(types[i]); ++i) {}
          order.push(new BidiSpan(0, start, i));
        } else {
          var pos = i, at = order.length;
          for (++i; i < len && types[i] != "L"; ++i) {}
          for (var j = pos; j < i;) {
            if (countsAsNum.test(types[j])) {
              if (pos < j) order.splice(at, 0, new BidiSpan(1, pos, j));
              var nstart = j;
              for (++j; j < i && countsAsNum.test(types[j]); ++j) {}
              order.splice(at, 0, new BidiSpan(2, nstart, j));
              pos = j;
            } else ++j;
          }
          if (pos < i) order.splice(at, 0, new BidiSpan(1, pos, i));
        }
      }
      if (order[0].level == 1 && (m = str.match(/^\s+/))) {
        order[0].from = m[0].length;
        order.unshift(new BidiSpan(0, 0, m[0].length));
      }
      if (lst(order).level == 1 && (m = str.match(/\s+$/))) {
        lst(order).to -= m[0].length;
        order.push(new BidiSpan(0, len - m[0].length, len));
      }
      if (order[0].level == 2)
        order.unshift(new BidiSpan(1, order[0].to, order[0].to));
      if (order[0].level != lst(order).level)
        order.push(new BidiSpan(order[0].level, len, len));

      return order;
    };
  })();

  // THE END

  CodeMirror.version = "5.8.0";

  return CodeMirror;
});

},{}],2:[function(require,module,exports){
/// <reference path="microReact.ts" />
/// <reference path="../vendor/marked.d.ts" />
var microReact = require("./microReact");
var runtime = require("./runtime");
var uiRenderer_1 = require("./uiRenderer");
var utils_1 = require("./utils");
exports.syncedTables = ["manual eav", "view", "action", "action source", "action mapping", "action mapping constant", "action mapping sorted", "action mapping limit", "add collection action", "add eav action", "add bit action"];
exports.eveLocalStorageKey = "eve";
//---------------------------------------------------------
// Renderer
//---------------------------------------------------------
var perfStats;
var perfStatsUi;
var updateStat = 0;
function initRenderer() {
    exports.renderer = new microReact.Renderer();
    exports.uiRenderer = new uiRenderer_1.UIRenderer(exports.eve);
    document.body.appendChild(exports.renderer.content);
    window.addEventListener("resize", render);
    perfStatsUi = document.createElement("div");
    perfStatsUi.id = "perfStats";
    document.body.appendChild(perfStatsUi);
}
if (utils_1.ENV === "browser")
    var performance = window["performance"] || { now: function () { return (new Date()).getTime(); } };
exports.renderRoots = {};
function render() {
    if (!exports.renderer || exports.renderer.queued)
        return;
    exports.renderer.queued = true;
    requestAnimationFrame(function () {
        var stats = {};
        var start = performance.now();
        var trees = [];
        for (var root in exports.renderRoots) {
            trees.push(exports.renderRoots[root]());
        }
        stats.root = (performance.now() - start).toFixed(2);
        if (+stats.root > 10)
            console.info("Slow root: " + stats.root);
        start = performance.now();
        var dynamicUI = exports.eve.find("system ui").map(function (ui) { return ui["template"]; });
        if (utils_1.DEBUG && utils_1.DEBUG.UI_COMPILE) {
            console.info("compiling", dynamicUI);
            console.info("*", exports.uiRenderer.compile(dynamicUI));
        }
        trees.push.apply(trees, exports.uiRenderer.compile(dynamicUI));
        stats.uiCompile = (performance.now() - start).toFixed(2);
        if (+stats.uiCompile > 10)
            console.info("Slow ui compile: " + stats.uiCompile);
        start = performance.now();
        exports.renderer.render(trees);
        stats.render = (performance.now() - start).toFixed(2);
        stats.update = updateStat.toFixed(2);
        perfStatsUi.textContent = "";
        perfStatsUi.textContent += "root: " + stats.root;
        perfStatsUi.textContent += " | ui compile: " + stats.uiCompile;
        perfStatsUi.textContent += " | render: " + stats.render;
        perfStatsUi.textContent += " | update: " + stats.update;
        perfStats = stats;
        exports.renderer.queued = false;
    });
}
exports.render = render;
var storeQueued = false;
function storeLocally() {
    if (storeQueued)
        return;
    storeQueued = true;
    setTimeout(function () {
        var serialized = exports.eve.serialize(true);
        if (exports.eveLocalStorageKey === "eve") {
            for (var _i = 0; _i < exports.syncedTables.length; _i++) {
                var synced = exports.syncedTables[_i];
                delete serialized[synced];
            }
        }
        delete serialized["provenance"];
        localStorage[exports.eveLocalStorageKey] = JSON.stringify(serialized);
        storeQueued = false;
    }, 1000);
}
//---------------------------------------------------------
// Dispatch
//---------------------------------------------------------
var dispatches = {};
function handle(event, func) {
    if (dispatches[event]) {
        console.error("Overwriting handler for '" + event + "'");
    }
    dispatches[event] = func;
}
exports.handle = handle;
function dispatch(event, info, dispatchInfo) {
    var result = dispatchInfo;
    if (!result) {
        result = exports.eve.diff();
        result.meta.render = true;
        result.meta.store = true;
    }
    result.dispatch = function (event, info) {
        return dispatch(event, info, result);
    };
    result.commit = function () {
        var start = performance.now();
        // result.remove("builtin entity", {entity: "render performance statistics"});
        // result.add("builtin entity", {entity: "render performance statistics", content: `
        // # Render performance statistics ({is a: system})
        // root: {root: ${perfStats.root}}
        // ui compile: {ui compile: ${perfStats.uiCompile}}
        // render: {render: ${perfStats.render}}
        // update: {update: ${perfStats.update}}
        // Horrible hack, disregard this: {perf stats: render performance statistics}
        // `});
        if (!runtime.INCREMENTAL) {
            exports.eve.applyDiff(result);
        }
        else {
            exports.eve.applyDiffIncremental(result);
        }
        if (result.meta.render) {
            render();
        }
        if (result.meta.store) {
            storeLocally();
            if (exports.eveLocalStorageKey === "eve") {
                sendChangeSet(result);
            }
        }
        updateStat = performance.now() - start;
    };
    var func = dispatches[event];
    if (!func) {
        console.error("No dispatches for '" + event + "' with " + JSON.stringify(info));
    }
    else {
        func(result, info);
    }
    return result;
}
exports.dispatch = dispatch;
//---------------------------------------------------------
// State
//---------------------------------------------------------
exports.eve = runtime.indexer();
exports.initializers = {};
exports.activeSearches = {};
function init(name, func) {
    exports.initializers[name] = func;
}
exports.init = init;
function executeInitializers() {
    for (var initName in exports.initializers) {
        exports.initializers[initName]();
    }
}
//---------------------------------------------------------
// Websocket
//---------------------------------------------------------
var me = utils_1.uuid();
if (this.localStorage) {
    if (localStorage["me"])
        me = localStorage["me"];
    else
        localStorage["me"] = me;
}
function connectToServer() {
    exports.socket = new WebSocket("ws://" + (window.location.hostname || "localhost") + ":8080");
    exports.socket.onerror = function () {
        console.error("Failed to connect to server, falling back to local storage");
        exports.eveLocalStorageKey = "local-eve";
        executeInitializers();
        render();
    };
    exports.socket.onopen = function () {
        sendServer("connect", me);
    };
    exports.socket.onmessage = function (data) {
        var parsed = JSON.parse(data.data);
        console.log("WS MESSAGE:", parsed);
        if (parsed.kind === "load") {
            exports.eve.load(parsed.data);
            executeInitializers();
            render();
        }
        else if (parsed.kind === "changeset") {
            var diff = exports.eve.diff();
            diff.tables = parsed.data;
            exports.eve.applyDiff(diff);
            render();
        }
    };
}
function sendServer(messageKind, data) {
    if (!exports.socket)
        return;
    exports.socket.send(JSON.stringify({ kind: messageKind, me: me, time: (new Date).getTime(), data: data }));
}
function sendChangeSet(changeset) {
    if (!exports.socket)
        return;
    var changes = {};
    var send = false;
    for (var _i = 0; _i < exports.syncedTables.length; _i++) {
        var table = exports.syncedTables[_i];
        if (changeset.tables[table]) {
            send = true;
            changes[table] = changeset.tables[table];
        }
    }
    if (send)
        sendServer("changeset", changes);
}
//---------------------------------------------------------
// Go
//---------------------------------------------------------
if (utils_1.ENV === "browser") {
    document.addEventListener("DOMContentLoaded", function (event) {
        initRenderer();
        connectToServer();
        render();
    });
}
init("load data", function () {
    var stored = localStorage[exports.eveLocalStorageKey];
    if (stored) {
        exports.eve.load(stored);
    }
});
if (utils_1.ENV === "browser")
    window["app"] = exports;

},{"./microReact":4,"./runtime":8,"./uiRenderer":11,"./utils":12}],3:[function(require,module,exports){
var utils_1 = require("./utils");
var runtime = require("./runtime");
var wiki_1 = require("./wiki");
var app = require("./app");
var app_1 = require("./app");
var queryParser_ts_1 = require("./queryParser.ts");
var parser_1 = require("./parser");
var uiRenderer_1 = require("./uiRenderer");
exports.ixer = app_1.eve;
//-----------------------------------------------------------------------------
// Utilities
//-----------------------------------------------------------------------------
function queryFromSearch(search) {
    var result = queryParser_ts_1.queryToExecutable(search);
    result.executable.ordinal();
    return result.executable;
}
function queryFromPlanDSL(str) {
    return queryParser_ts_1.queryToExecutable(parser_1.parsePlan(str));
}
exports.queryFromPlanDSL = queryFromPlanDSL;
function queryFromQueryDSL(str) {
    var plan = parser_1.parseQuery(str);
    var query = new runtime.Query(exports.ixer);
    var ix = 0;
    for (var _i = 0; _i < plan.length; _i++) {
        var step = plan[_i];
        var id = step.id || step.type + "||" + ix;
        if (step.type === "select")
            query.select(step["view"], step["join"] || {}, step.id);
        else if (step.type === "deselect")
            query.deselect(step["view"], step["join"] || {});
        else if (step.type === "calculate")
            query.calculate(step["func"], step["args"], step.id);
        else if (step.type === "aggregate")
            query.aggregate(step["func"], step["args"], step.id);
        else if (step.type === "ordinal")
            query.ordinal();
        else if (step.type === "group")
            query.group(step["groups"]);
        else if (step.type === "sort")
            query.sort(step["sorts"]);
        else if (step.type === "limit")
            query.limit(step["limit"]);
        else if (step.type === "project")
            query.project(step["mapping"]);
        else
            throw new Error("Unknown query step type '" + step.type + "'");
    }
    return query;
}
exports.queryFromQueryDSL = queryFromQueryDSL;
function UIFromDSL(str) {
    function processElem(data) {
        var elem = new uiRenderer_1.UI(data.id || uuid());
        if (data.binding)
            elem.bind(data.bindingKind === "query" ? queryFromQueryDSL(data.binding) : queryFromPlanDSL(data.binding));
        if (data.embedded)
            elem.embed(data.embedded);
        if (data.attributes)
            elem.attributes(data.attributes);
        if (data.events)
            elem.events(data.events);
        if (data.children) {
            for (var _i = 0, _a = data.children; _i < _a.length; _i++) {
                var child = _a[_i];
                elem.child(processElem(child));
            }
        }
        return elem;
    }
    return processElem(parser_1.parseUI(str));
}
exports.UIFromDSL = UIFromDSL;
var BSPhase = (function () {
    function BSPhase(ixer, changeset) {
        if (changeset === void 0) { changeset = ixer.diff(); }
        this.ixer = ixer;
        this.changeset = changeset;
        this._views = {};
        this._viewFields = {};
        this._entities = [];
        this._uis = {};
        this._queries = {};
        this._names = {};
    }
    BSPhase.prototype.viewKind = function (view) {
        return this._views[view];
    };
    BSPhase.prototype.viewFields = function (view) {
        return this._viewFields[view];
    };
    BSPhase.prototype.apply = function (nukeExisting) {
        for (var view in this._views) {
            if (this._views[view] === "table")
                exports.ixer.addTable(view, this._viewFields[view]);
        }
        if (nukeExisting) {
            for (var view in this._views) {
                if (this._views[view] !== "table")
                    this.changeset.merge(runtime.Query.remove(view, this.ixer));
            }
            for (var _i = 0, _a = this._entities; _i < _a.length; _i++) {
                var entity = _a[_i];
                this.changeset.remove("builtin entity", { entity: entity });
            }
            for (var ui in this._uis)
                this.changeset.merge(uiRenderer_1.UI.remove(ui, this.ixer));
        }
        exports.ixer.applyDiff(this.changeset);
    };
    //-----------------------------------------------------------------------------
    // Macros
    //-----------------------------------------------------------------------------
    BSPhase.prototype.addFact = function (table, fact) {
        this.changeset.add(table, fact);
        return this;
    };
    BSPhase.prototype.addEntity = function (entity, name, kinds, attributes, extraContent) {
        entity = "AUTOGENERATED " + entity + " THIS SHOULDN'T SHOW UP ANYWHERE";
        this._names[name] = entity;
        this._entities.push(entity);
        this.addFact("display name", { id: entity, name: name });
        var isAs = [];
        for (var _i = 0; _i < kinds.length; _i++) {
            var kind = kinds[_i];
            var sourceId = entity + ",is a," + kind;
            isAs.push("{" + kind + "|eav source = " + sourceId + "}");
            var collEntity = "AUTOGENERATED " + kind + " THIS SHOULDN'T SHOW UP ANYWHERE";
            this.addFact("display name", { id: collEntity, name: kind });
            this.addFact("sourced eav", { entity: entity, attribute: "is a", value: collEntity, source: sourceId });
        }
        var collectionsText = "";
        if (isAs.length)
            collectionsText = utils_1.titlecase(name) + " is a " + isAs.slice(0, -1).join(", ") + " " + (isAs.length > 1 ? "and" : "") + " " + isAs[isAs.length - 1] + ".";
        var content = (_a = ["\n      # ", "\n      ", "\n    "], _a.raw = ["\n      # ", "\n      ", "\n    "], utils_1.unpad(6)(_a, name, collectionsText));
        if (attributes) {
            content += "Attributes\n";
            for (var attr in attributes) {
                var sourceId = entity + "," + attr + "," + attributes[attr];
                content += attr + ": {" + name + "'s " + attr + "|eav source = " + sourceId + "}\n      ";
                var value = this._names[attributes[attr]] || attributes[attr];
                this.addFact("sourced eav", { entity: entity, attribute: attr, value: value, source: sourceId });
            }
        }
        if (extraContent)
            content += "\n" + extraContent;
        var page = entity + "|root";
        this.addFact("page content", { page: page, content: content });
        this.addFact("entity page", { entity: entity, page: page });
        return this;
        var _a;
    };
    BSPhase.prototype.addView = function (view, kind, fields) {
        this._views[view] = kind;
        this._viewFields[view] = fields;
        this.addFact("view", { view: view, kind: kind });
        for (var _i = 0; _i < fields.length; _i++) {
            var field = fields[_i];
            this.addFact("field", { view: view, field: field });
        }
        this.addEntity(view, view, ["system", kind], undefined, (_a = ["\n      ## Fields\n      ", "\n    "], _a.raw = ["\n      ## Fields\n      ", "\n    "], utils_1.unpad(6)(_a, fields.map(function (field) { return ("* " + field); }).join("\n      "))));
        return this;
        var _a;
    };
    BSPhase.prototype.addTable = function (view, fields) {
        this.addView(view, "table", fields);
        return this;
    };
    BSPhase.prototype.addUnion = function (view, fields, builtin) {
        if (builtin === void 0) { builtin = true; }
        this.addView(view, "union", fields);
        if (builtin) {
            var table = "builtin " + view;
            this.addTable(table, fields);
            this.addUnionMember(view, table);
        }
        return this;
    };
    BSPhase.prototype.addUnionMember = function (union, member, mapping) {
        // apply the natural mapping.
        if (!mapping) {
            if (this.viewKind(union) !== "union")
                throw new Error("Union '" + union + "' must be added before adding members");
            mapping = {};
            for (var _i = 0, _a = this.viewFields(union); _i < _a.length; _i++) {
                var field = _a[_i];
                mapping[field] = field;
            }
        }
        var action = union + " <-- " + member + " <-- " + JSON.stringify(mapping);
        this.addFact("action", { view: union, action: action, kind: "union", ix: 0 })
            .addFact("action source", { action: action, "source view": member });
        for (var field in mapping) {
            var mapped = mapping[field];
            if (mapped.constructor === Array) {
                this.addFact("action mapping constant", { action: action, from: field, "value": mapped[0] });
            }
            else {
                this.addFact("action mapping", { action: action, from: field, "to source": member, "to field": mapped });
            }
        }
        return this;
    };
    BSPhase.prototype.addQuery = function (view, query) {
        query.name = view;
        this._queries[view] = query;
        this.addView(view, "query", Object.keys(query.projectionMap || {}));
        this.changeset.merge(query.changeset(this.ixer));
        return this;
    };
    BSPhase.prototype.addArtifacts = function (artifacts) {
        var views = artifacts.views;
        console.log("adding artifacts", views);
        for (var id in views)
            this.changeset.merge(views[id].changeset(app_1.eve));
        return this;
    };
    BSPhase.prototype.addUI = function (id, ui) {
        ui.id = id;
        this._uis[id] = ui;
        this.addEntity(id, id, ["system", "ui"]);
        this.changeset.merge(ui.changeset(this.ixer));
        return this;
    };
    BSPhase.prototype.generateBitAction = function (name, queryOrName, template) {
        var query;
        if (typeof queryOrName === "string")
            query = this._queries[queryOrName];
        else
            query = queryOrName;
        this.changeset.merge(wiki_1.addBitAction(name, template));
        return this;
    };
    return BSPhase;
})();
//-----------------------------------------------------------------------------
// Runtime Setup
//-----------------------------------------------------------------------------
runtime.define("parse natural", { multi: true }, function (text) {
    return queryParser_ts_1.queryToExecutable(text).plan;
});
runtime.define("parse plan", { multi: true }, function (text) {
    return parser_1.parsePlan(text);
});
app.init("bootstrap", function bootstrap() {
    //-----------------------------------------------------------------------------
    // Entity System
    //-----------------------------------------------------------------------------
    var phase = new BSPhase(app_1.eve);
    phase.addTable("manual entity", ["entity", "content"]);
    phase.addTable("manual eav", ["entity", "attribute", "value"]);
    phase.addTable("sourced eav", ["entity", "attribute", "value", "source"]);
    phase.addTable("page content", ["page", "content"]);
    phase.addTable("entity page", ["entity", "page"]);
    phase.addTable("action entity", ["entity", "content", "source"]);
    phase.addEntity("collection", "collection", ["system"])
        .addEntity("system", "system", ["collection"])
        .addEntity("union", "union", ["system", "collection"])
        .addEntity("query", "query", ["system", "collection"])
        .addEntity("table", "table", ["system", "collection"])
        .addEntity("ui", "ui", ["system", "collection"]);
    phase.addQuery("entity", queryFromQueryDSL((_a = ["\n    select entity page as [ent]\n    select page content {page: [ent, page]} as [page]\n    project {entity: [ent, entity]; content: [page, content]}\n  "], _a.raw = ["\n    select entity page as [ent]\n    select page content {page: [ent, page]} as [page]\n    project {entity: [ent, entity]; content: [page, content]}\n  "], utils_1.unpad(4)(_a))));
    phase.addQuery("unmodified added bits", queryFromQueryDSL((_b = ["\n    select added bits as [added]\n    deselect manual entity {entity: [added, entity]}\n    project {entity: [added, entity]; content: [added, content]}\n  "], _b.raw = ["\n    select added bits as [added]\n    deselect manual entity {entity: [added, entity]}\n    project {entity: [added, entity]; content: [added, content]}\n  "], utils_1.unpad(4)(_b))));
    phase.addUnion("entity eavs", ["entity", "attribute", "value"], true)
        .addUnionMember("entity eavs", "manual eav")
        .addUnionMember("entity eavs", "generated eav", { entity: "entity", attribute: "attribute", value: "value" })
        .addUnionMember("entity eavs", "sourced eav", { entity: "entity", attribute: "attribute", value: "value" })
        .addUnionMember("entity eavs", "added eavs");
    phase.addQuery("is a attributes", queryFromQueryDSL((_c = ["\n    select entity eavs {attribute: is a} as [is a]\n    project {collection: [is a, value]; entity: [is a, entity]}\n  "], _c.raw = ["\n    select entity eavs {attribute: is a} as [is a]\n    project {collection: [is a, value]; entity: [is a, entity]}\n  "], utils_1.unpad(4)(_c))));
    // @HACK: this view is required because you can't currently join a select on the result of a function.
    // so we create a version of the eavs table that already has everything lowercased.
    phase.addQuery("lowercase eavs", queryFromQueryDSL((_d = ["\n    select entity eavs as [eav]\n    calculate lowercase {text: [eav, value]} as [lower]\n    project {entity: [eav, entity];  attribute: [eav, attribute]; value: [lower, result]}\n  "], _d.raw = ["\n    select entity eavs as [eav]\n    calculate lowercase {text: [eav, value]} as [lower]\n    project {entity: [eav, entity];  attribute: [eav, attribute]; value: [lower, result]}\n  "], utils_1.unpad(4)(_d))));
    phase.addQuery("eav entity links", queryFromQueryDSL((_e = ["\n    select lowercase eavs as [eav]\n    select entity {entity: [eav, value]} as [entity]\n    project {entity: [eav, entity]; link: [entity, entity]; type: [eav, attribute]}\n  "], _e.raw = ["\n    select lowercase eavs as [eav]\n    select entity {entity: [eav, value]} as [entity]\n    project {entity: [eav, entity]; link: [entity, entity]; type: [eav, attribute]}\n  "], utils_1.unpad(4)(_e))));
    phase.addUnion("entity links", ["entity", "link", "type"])
        .addUnionMember("entity links", "eav entity links")
        .addUnionMember("entity links", "is a attributes", { entity: "entity", link: "collection", type: ["is a"] });
    phase.addUnion("directionless links", ["entity", "link"])
        .addUnionMember("directionless links", "entity links")
        .addUnionMember("directionless links", "entity links", { entity: "link", link: "entity" });
    phase.addUnion("collection entities", ["entity", "collection"])
        .addUnionMember("collection entities", "is a attributes");
    phase.addQuery("collection", queryFromQueryDSL((_f = ["\n    select is a attributes as [coll]\n    group {[coll, collection]}\n    aggregate count as [count]\n    project {collection: [coll, collection]; count: [count, count]}\n  "], _f.raw = ["\n    select is a attributes as [coll]\n    group {[coll, collection]}\n    aggregate count as [count]\n    project {collection: [coll, collection]; count: [count, count]}\n  "], utils_1.unpad(4)(_f))));
    phase.addTable("ui pane", ["pane", "contains", "kind"]);
    if (app_1.eve.find("ui pane").length === 0)
        phase.addFact("ui pane", { pane: "p1", contains: "pet", kind: 0 });
    // phase.addArtifacts(parseDSL(unpad(4) `
    //   (query
    //     (is-a-attributes :entity entity :collection "ui pane")
    //     (entity-eavs :attribute "contains" :value contains)
    //     (project! "ui pane" :pane entity :contains contains))
    // `));
    phase.apply(true);
    //-----------------------------------------------------------------------------
    // Wiki Logic
    //-----------------------------------------------------------------------------
    phase = new BSPhase(app_1.eve);
    phase.addUnion("search", ["id", "top", "left"]);
    phase.addUnion("search query", ["id", "search"]);
    // phase.addQuery("searches to entities shim", queryFromQueryDSL(unpad(4) `
    //   select search as [search]
    //   select search query {id: [search, id]} as [query]
    //   project {id: [search, id]; text: [query, search]; top: [search, top]; left: [search, left]}
    // `));
    //   phase.generateBitAction("searches to entities shim", "searches to entities shim", unpad(4) `
    //     # {id}
    //     ({is a: search}, {is a: system})
    //     search: {search: {search}}
    //     left: {left: {left}}
    //     top: {top: {top}}
    //   `);
    phase.apply(true);
    //-----------------------------------------------------------------------------
    // UI
    //-----------------------------------------------------------------------------
    phase = new BSPhase(app_1.eve);
    // @FIXME: These should probably be unionized.
    function resolve(table, fields) {
        return fields.map(function (field) { return (table + ": " + field); });
    }
    phase.addTable("ui template", resolve("ui template", ["template", "parent", "ix"]));
    phase.addTable("ui template binding", resolve("ui template binding", ["template", "query"]));
    phase.addTable("ui embed", resolve("ui embed", ["embed", "template", "parent", "ix"]));
    phase.addTable("ui embed scope", resolve("ui embed scope", ["embed", "key", "value"]));
    phase.addTable("ui embed scope binding", resolve("ui embed scope binding", ["embed", "key", "source", "alias"]));
    phase.addTable("ui attribute", resolve("ui attribute", ["template", "property", "value"]));
    phase.addTable("ui attribute binding", resolve("ui attribute binding", ["template", "property", "source", "alias"]));
    phase.addTable("ui event", resolve("ui event", ["template", "event"]));
    phase.addTable("ui event state", resolve("ui event state", ["template", "event", "key", "value"]));
    phase.addTable("ui event state binding", resolve("ui event state binding", ["template", "event", "key", "source", "alias"]));
    phase.addTable("system ui", ["template"]);
    phase.apply(true);
    //-----------------------------------------------------------------------------
    // Testing
    //-----------------------------------------------------------------------------
    phase = new BSPhase(app_1.eve);
    var testData = {
        "test data": ["collection"],
        pet: ["collection"],
        exotic: ["collection"],
        dangerous: ["collection"],
        cat: ["pet"],
        dog: ["pet"],
        fish: ["pet"],
        snake: ["pet", "exotic"],
        koala: ["pet", "exotic"],
        sloth: ["pet", "exotic"],
        kangaroo: ["exotic"],
        giraffe: ["exotic"],
        gorilla: ["exotic", "dangerous"],
        kodowa: ["company"],
        engineering: ["department"],
        operations: ["department"],
        magic: ["department"],
        josh: ["employee"],
        corey: ["employee"],
        jamie: ["employee"],
        chris: ["employee"],
        rob: ["employee"],
        eric: ["employee"],
    };
    var testAttrs = {
        cat: { length: 4 },
        dog: { length: 3 },
        fish: { length: 1 },
        snake: { length: 4 },
        koala: { length: 3 },
        sloth: { length: 3 },
        engineering: { company: "kodowa" },
        operations: { company: "kodowa" },
        magic: { company: "kodowa" },
        josh: { department: "engineering", salary: 7 },
        corey: { department: "engineering", salary: 10 },
        jamie: { department: "engineering", salary: 7 },
        chris: { department: "engineering", salary: 10 },
        eric: { department: "engineering", salary: 7 },
        rob: { department: "operations", salary: 10 },
    };
    for (var entity in testData)
        phase.addEntity(entity, entity, ["test data"].concat(testData[entity]), testAttrs[entity]);
    // phase.addTable("department", ["department"])
    //   .addFact("department", {department: "engineering"})
    //   .addFact("department", {department: "operations"})
    //   .addFact("department", {department: "magic"});
    // phase.addTable("employee", ["department", "employee", "salary"])
    //   .addFact("employee", {department: "engineering", employee: "josh", salary: 10})
    //   .addFact("employee", {department: "engineering", employee: "corey", salary: 11})
    //   .addFact("employee", {department: "engineering", employee: "chris", salary: 7})
    //   .addFact("employee", {department: "operations", employee: "rob", salary: 7});
    phase.apply(true);
    window["p"] = phase;
    var _a, _b, _c, _d, _e, _f;
});
window["bootstrap"] = exports;

},{"./app":2,"./parser":5,"./queryParser.ts":6,"./runtime":8,"./uiRenderer":11,"./utils":12,"./wiki":13}],4:[function(require,module,exports){
function now() {
    if (window.performance) {
        return window.performance.now();
    }
    return (new Date()).getTime();
}
function shallowEquals(a, b) {
    if (a === b)
        return true;
    if (!a || !b)
        return false;
    for (var k in a) {
        if (a[k] !== b[k])
            return false;
    }
    for (var k in b) {
        if (b[k] !== a[k])
            return false;
    }
    return true;
}
function postAnimationRemove(elements) {
    for (var _i = 0; _i < elements.length; _i++) {
        var elem = elements[_i];
        if (elem.parentNode)
            elem.parentNode.removeChild(elem);
    }
}
var Renderer = (function () {
    function Renderer() {
        this.content = document.createElement("div");
        this.content.className = "__root";
        this.elementCache = { "__root": this.content };
        this.prevTree = {};
        this.tree = {};
        this.postRenders = [];
        this.lastDiff = { adds: [], updates: {} };
        var self = this;
        this.handleEvent = function handleEvent(e) {
            var id = (e.currentTarget || e.target)["_id"];
            var elem = self.tree[id];
            if (!elem)
                return;
            var handler = elem[e.type];
            if (handler) {
                handler(e, elem);
            }
        };
    }
    Renderer.prototype.reset = function () {
        this.prevTree = this.tree;
        this.tree = {};
        this.postRenders = [];
    };
    Renderer.prototype.domify = function () {
        var fakePrev = {}; //create an empty object once instead of every instance of the loop
        var elements = this.tree;
        var prevElements = this.prevTree;
        var diff = this.lastDiff;
        var adds = diff.adds;
        var updates = diff.updates;
        var elemKeys = Object.keys(updates);
        var elementCache = this.elementCache;
        var tempTween = {};
        //Create all the new elements to ensure that they're there when they need to be
        //parented
        for (var i = 0, len = adds.length; i < len; i++) {
            var id = adds[i];
            var cur = elements[id];
            var div;
            if (cur.svg) {
                div = document.createElementNS("http://www.w3.org/2000/svg", cur.t || "rect");
            }
            else {
                div = document.createElement(cur.t || "div");
            }
            div._id = id;
            elementCache[id] = div;
            if (cur.enter) {
                if (cur.enter.delay) {
                    cur.enter.display = "auto";
                    div.style.display = "none";
                }
                Velocity(div, cur.enter, cur.enter);
            }
        }
        for (var i = 0, len = elemKeys.length; i < len; i++) {
            var id = elemKeys[i];
            var cur = elements[id];
            var prev = prevElements[id] || fakePrev;
            var type = updates[id];
            var div;
            if (type === "replaced") {
                var me = elementCache[id];
                if (me.parentNode)
                    me.parentNode.removeChild(me);
                if (cur.svg) {
                    div = document.createElementNS("http://www.w3.org/2000/svg", cur.t || "rect");
                }
                else {
                    div = document.createElement(cur.t || "div");
                }
                div._id = id;
                elementCache[id] = div;
            }
            else if (type === "removed") {
                //NOTE: Batching the removes such that you only remove the parent
                //didn't actually make this faster surprisingly. Given that this
                //strategy is much simpler and there's no noticable perf difference
                //we'll just do the dumb thing and remove all the children one by one.
                var me = elementCache[id];
                if (prev.leave) {
                    prev.leave.complete = postAnimationRemove;
                    if (prev.leave.absolute) {
                        me.style.position = "absolute";
                    }
                    Velocity(me, prev.leave, prev.leave);
                }
                else if (me.parentNode)
                    me.parentNode.removeChild(me);
                elementCache[id] = null;
                continue;
            }
            else {
                div = elementCache[id];
            }
            var style = div.style;
            if (cur.c !== prev.c)
                div.className = cur.c;
            if (cur.draggable !== prev.draggable)
                div.draggable = cur.draggable === undefined ? null : "true";
            if (cur.contentEditable !== prev.contentEditable)
                div.contentEditable = cur.contentEditable || "inherit";
            if (cur.colspan !== prev.colspan)
                div.colSpan = cur.colspan;
            if (cur.placeholder !== prev.placeholder)
                div.placeholder = cur.placeholder;
            if (cur.selected !== prev.selected)
                div.selected = cur.selected;
            if (cur.value !== prev.value)
                div.value = cur.value;
            if (cur.t === "input" && cur.type !== prev.type)
                div.type = cur.type;
            if (cur.t === "input" && cur.checked !== prev.checked)
                div.checked = cur.checked;
            if ((cur.text !== prev.text || cur.strictText) && div.textContent !== cur.text)
                div.textContent = cur.text === undefined ? "" : cur.text;
            if (cur.tabindex !== prev.tabindex)
                div.setAttribute("tabindex", cur.tabindex);
            if (cur.href !== prev.href)
                div.setAttribute("href", cur.href);
            // animateable properties
            var tween = cur.tween || tempTween;
            if (cur.flex !== prev.flex) {
                if (tween.flex)
                    tempTween.flex = cur.flex;
                else
                    style.flex = cur.flex === undefined ? "" : cur.flex;
            }
            if (cur.left !== prev.left) {
                if (tween.left)
                    tempTween.left = cur.left;
                else
                    style.left = cur.left === undefined ? "" : cur.left;
            }
            if (cur.top !== prev.top) {
                if (tween.top)
                    tempTween.top = cur.top;
                else
                    style.top = cur.top === undefined ? "" : cur.top;
            }
            if (cur.height !== prev.height) {
                if (tween.height)
                    tempTween.height = cur.height;
                else
                    style.height = cur.height === undefined ? "auto" : cur.height;
            }
            if (cur.width !== prev.width) {
                if (tween.width)
                    tempTween.width = cur.width;
                else
                    style.width = cur.width === undefined ? "auto" : cur.width;
            }
            if (cur.zIndex !== prev.zIndex) {
                if (tween.zIndex)
                    tempTween.zIndex = cur.zIndex;
                else
                    style.zIndex = cur.zIndex;
            }
            if (cur.backgroundColor !== prev.backgroundColor) {
                if (tween.backgroundColor)
                    tempTween.backgroundColor = cur.backgroundColor;
                else
                    style.backgroundColor = cur.backgroundColor || "transparent";
            }
            if (cur.borderColor !== prev.borderColor) {
                if (tween.borderColor)
                    tempTween.borderColor = cur.borderColor;
                else
                    style.borderColor = cur.borderColor || "none";
            }
            if (cur.borderWidth !== prev.borderWidth) {
                if (tween.borderWidth)
                    tempTween.borderWidth = cur.borderWidth;
                else
                    style.borderWidth = cur.borderWidth || 0;
            }
            if (cur.borderRadius !== prev.borderRadius) {
                if (tween.borderRadius)
                    tempTween.borderRadius = cur.borderRadius;
                else
                    style.borderRadius = (cur.borderRadius || 0) + "px";
            }
            if (cur.opacity !== prev.opacity) {
                if (tween.opacity)
                    tempTween.opacity = cur.opacity;
                else
                    style.opacity = cur.opacity === undefined ? 1 : cur.opacity;
            }
            if (cur.fontSize !== prev.fontSize) {
                if (tween.fontSize)
                    tempTween.fontSize = cur.fontSize;
                else
                    style.fontSize = cur.fontSize;
            }
            if (cur.color !== prev.color) {
                if (tween.color)
                    tempTween.color = cur.color;
                else
                    style.color = cur.color || "inherit";
            }
            var animKeys = Object.keys(tempTween);
            if (animKeys.length) {
                Velocity(div, tempTween, tween);
                tempTween = {};
            }
            // non-animation style properties
            if (cur.backgroundImage !== prev.backgroundImage)
                style.backgroundImage = "url('" + cur.backgroundImage + "')";
            if (cur.border !== prev.border)
                style.border = cur.border || "none";
            if (cur.textAlign !== prev.textAlign) {
                style.alignItems = cur.textAlign;
                if (cur.textAlign === "center") {
                    style.textAlign = "center";
                }
                else if (cur.textAlign === "flex-end") {
                    style.textAlign = "right";
                }
                else {
                    style.textAlign = "left";
                }
            }
            if (cur.verticalAlign !== prev.verticalAlign)
                style.justifyContent = cur.verticalAlign;
            if (cur.fontFamily !== prev.fontFamily)
                style.fontFamily = cur.fontFamily || "inherit";
            if (cur.transform !== prev.transform)
                style.transform = cur.transform || "none";
            if (cur.style !== prev.style)
                div.setAttribute("style", cur.style);
            if (cur.dangerouslySetInnerHTML !== prev.dangerouslySetInnerHTML)
                div.innerHTML = cur.dangerouslySetInnerHTML;
            // debug/programmatic properties
            if (cur.semantic !== prev.semantic)
                div.setAttribute("data-semantic", cur.semantic);
            if (cur.debug !== prev.debug)
                div.setAttribute("data-debug", cur.debug);
            // SVG properties
            if (cur.svg) {
                if (cur.fill !== prev.fill)
                    div.setAttributeNS(null, "fill", cur.fill);
                if (cur.stroke !== prev.stroke)
                    div.setAttributeNS(null, "stroke", cur.stroke);
                if (cur.strokeWidth !== prev.strokeWidth)
                    div.setAttributeNS(null, "stroke-width", cur.strokeWidth);
                if (cur.d !== prev.d)
                    div.setAttributeNS(null, "d", cur.d);
                if (cur.c !== prev.c)
                    div.setAttributeNS(null, "class", cur.c);
                if (cur.x !== prev.x)
                    div.setAttributeNS(null, "x", cur.x);
                if (cur.y !== prev.y)
                    div.setAttributeNS(null, "y", cur.y);
                if (cur.dx !== prev.dx)
                    div.setAttributeNS(null, "dx", cur.dx);
                if (cur.dy !== prev.dy)
                    div.setAttributeNS(null, "dy", cur.dy);
                if (cur.cx !== prev.cx)
                    div.setAttributeNS(null, "cx", cur.cx);
                if (cur.cy !== prev.cy)
                    div.setAttributeNS(null, "cy", cur.cy);
                if (cur.r !== prev.r)
                    div.setAttributeNS(null, "r", cur.r);
                if (cur.height !== prev.height)
                    div.setAttributeNS(null, "height", cur.height);
                if (cur.width !== prev.width)
                    div.setAttributeNS(null, "width", cur.width);
                if (cur.xlinkhref !== prev.xlinkhref)
                    div.setAttributeNS('http://www.w3.org/1999/xlink', "href", cur.xlinkhref);
                if (cur.startOffset !== prev.startOffset)
                    div.setAttributeNS(null, "startOffset", cur.startOffset);
                if (cur.id !== prev.id)
                    div.setAttributeNS(null, "id", cur.id);
                if (cur.viewBox !== prev.viewBox)
                    div.setAttributeNS(null, "viewBox", cur.viewBox);
                if (cur.transform !== prev.transform)
                    div.setAttributeNS(null, "transform", cur.transform);
                if (cur.draggable !== prev.draggable)
                    div.setAttributeNS(null, "draggable", cur.draggable);
                if (cur.textAnchor !== prev.textAnchor)
                    div.setAttributeNS(null, "text-anchor", cur.textAnchor);
            }
            //events
            if (cur.dblclick !== prev.dblclick)
                div.ondblclick = cur.dblclick !== undefined ? this.handleEvent : undefined;
            if (cur.click !== prev.click)
                div.onclick = cur.click !== undefined ? this.handleEvent : undefined;
            if (cur.contextmenu !== prev.contextmenu)
                div.oncontextmenu = cur.contextmenu !== undefined ? this.handleEvent : undefined;
            if (cur.mousedown !== prev.mousedown)
                div.onmousedown = cur.mousedown !== undefined ? this.handleEvent : undefined;
            if (cur.mousemove !== prev.mousemove)
                div.onmousemove = cur.mousemove !== undefined ? this.handleEvent : undefined;
            if (cur.mouseup !== prev.mouseup)
                div.onmouseup = cur.mouseup !== undefined ? this.handleEvent : undefined;
            if (cur.mouseover !== prev.mouseover)
                div.onmouseover = cur.mouseover !== undefined ? this.handleEvent : undefined;
            if (cur.mouseout !== prev.mouseout)
                div.onmouseout = cur.mouseout !== undefined ? this.handleEvent : undefined;
            if (cur.mouseleave !== prev.mouseleave)
                div.onmouseleave = cur.mouseleave !== undefined ? this.handleEvent : undefined;
            if (cur.mousewheel !== prev.mousewheel)
                div.onmouseheel = cur.mousewheel !== undefined ? this.handleEvent : undefined;
            if (cur.dragover !== prev.dragover)
                div.ondragover = cur.dragover !== undefined ? this.handleEvent : undefined;
            if (cur.dragstart !== prev.dragstart)
                div.ondragstart = cur.dragstart !== undefined ? this.handleEvent : undefined;
            if (cur.dragend !== prev.dragend)
                div.ondragend = cur.dragend !== undefined ? this.handleEvent : undefined;
            if (cur.drag !== prev.drag)
                div.ondrag = cur.drag !== undefined ? this.handleEvent : undefined;
            if (cur.drop !== prev.drop)
                div.ondrop = cur.drop !== undefined ? this.handleEvent : undefined;
            if (cur.scroll !== prev.scroll)
                div.onscroll = cur.scroll !== undefined ? this.handleEvent : undefined;
            if (cur.focus !== prev.focus)
                div.onfocus = cur.focus !== undefined ? this.handleEvent : undefined;
            if (cur.blur !== prev.blur)
                div.onblur = cur.blur !== undefined ? this.handleEvent : undefined;
            if (cur.input !== prev.input)
                div.oninput = cur.input !== undefined ? this.handleEvent : undefined;
            if (cur.change !== prev.change)
                div.onchange = cur.change !== undefined ? this.handleEvent : undefined;
            if (cur.keyup !== prev.keyup)
                div.onkeyup = cur.keyup !== undefined ? this.handleEvent : undefined;
            if (cur.keydown !== prev.keydown)
                div.onkeydown = cur.keydown !== undefined ? this.handleEvent : undefined;
            if (type === "added" || type === "replaced" || type === "moved") {
                var parentEl = elementCache[cur.parent];
                if (parentEl) {
                    if (cur.ix >= parentEl.children.length) {
                        parentEl.appendChild(div);
                    }
                    else {
                        parentEl.insertBefore(div, parentEl.children[cur.ix]);
                    }
                }
            }
        }
    };
    Renderer.prototype.diff = function () {
        var a = this.prevTree;
        var b = this.tree;
        var as = Object.keys(a);
        var bs = Object.keys(b);
        var updated = {};
        var adds = [];
        for (var i = 0, len = as.length; i < len; i++) {
            var id = as[i];
            var curA = a[id];
            var curB = b[id];
            if (curB === undefined) {
                updated[id] = "removed";
                continue;
            }
            if (curA.t !== curB.t) {
                updated[id] = "replaced";
                continue;
            }
            if (curA.ix !== curB.ix || curA.parent !== curB.parent) {
                updated[id] = "moved";
                continue;
            }
            if (!curB.dirty
                && curA.c === curB.c
                && curA.key === curB.key
                && curA.dangerouslySetInnerHTML === curB.dangerouslySetInnerHTML
                && curA.tabindex === curB.tabindex
                && curA.href === curB.href
                && curA.placeholder === curB.placeholder
                && curA.selected === curB.selected
                && curA.draggable === curB.draggable
                && curA.contentEditable === curB.contentEditable
                && curA.value === curB.value
                && curA.type === curB.type
                && curA.checked === curB.checked
                && curA.text === curB.text
                && curA.top === curB.top
                && curA.flex === curB.flex
                && curA.left === curB.left
                && curA.width === curB.width
                && curA.height === curB.height
                && curA.zIndex === curB.zIndex
                && curA.backgroundColor === curB.backgroundColor
                && curA.backgroundImage === curB.backgroundImage
                && curA.color === curB.color
                && curA.colspan === curB.colspan
                && curA.border === curB.border
                && curA.borderColor === curB.borderColor
                && curA.borderWidth === curB.borderWidth
                && curA.borderRadius === curB.borderRadius
                && curA.opacity === curB.opacity
                && curA.fontFamily === curB.fontFamily
                && curA.fontSize === curB.fontSize
                && curA.textAlign === curB.textAlign
                && curA.transform === curB.transform
                && curA.verticalAlign === curB.verticalAlign
                && curA.semantic === curB.semantic
                && curA.debug === curB.debug
                && curA.style === curB.style
                && (curB.svg === undefined || (curA.x === curB.x
                    && curA.y === curB.y
                    && curA.dx === curB.dx
                    && curA.dy === curB.dy
                    && curA.cx === curB.cx
                    && curA.cy === curB.cy
                    && curA.r === curB.r
                    && curA.d === curB.d
                    && curA.fill === curB.fill
                    && curA.stroke === curB.stroke
                    && curA.strokeWidth === curB.strokeWidth
                    && curA.startOffset === curB.startOffset
                    && curA.textAnchor === curB.textAnchor
                    && curA.viewBox === curB.viewBox
                    && curA.xlinkhref === curB.xlinkhref))) {
                continue;
            }
            updated[id] = "updated";
        }
        for (var i = 0, len = bs.length; i < len; i++) {
            var id = bs[i];
            var curA = a[id];
            if (curA === undefined) {
                adds.push(id);
                updated[id] = "added";
                continue;
            }
        }
        this.lastDiff = { adds: adds, updates: updated };
        return this.lastDiff;
    };
    Renderer.prototype.prepare = function (root) {
        var elemLen = 1;
        var tree = this.tree;
        var elements = [root];
        var elem;
        for (var elemIx = 0; elemIx < elemLen; elemIx++) {
            elem = elements[elemIx];
            if (elem.parent === undefined)
                elem.parent = "__root";
            if (elem.id === undefined)
                elem.id = "__root__" + elemIx;
            tree[elem.id] = elem;
            if (elem.postRender !== undefined) {
                this.postRenders.push(elem);
            }
            var children = elem.children;
            if (children !== undefined) {
                for (var childIx = 0, len = children.length; childIx < len; childIx++) {
                    var child = children[childIx];
                    if (child === undefined)
                        continue;
                    if (child.id === undefined) {
                        child.id = elem.id + "__" + childIx;
                    }
                    if (child.ix === undefined) {
                        child.ix = childIx;
                    }
                    if (child.parent === undefined) {
                        child.parent = elem.id;
                    }
                    elements.push(child);
                    elemLen++;
                }
            }
        }
        return tree;
    };
    Renderer.prototype.postDomify = function () {
        var postRenders = this.postRenders;
        var diff = this.lastDiff.updates;
        var elementCache = this.elementCache;
        for (var i = 0, len = postRenders.length; i < len; i++) {
            var elem = postRenders[i];
            var id = elem.id;
            if (diff[id] === "updated" || diff[id] === "added" || diff[id] === "replaced" || elem.dirty) {
                elem.postRender(elementCache[elem.id], elem);
            }
        }
    };
    Renderer.prototype.render = function (elems) {
        this.reset();
        // We sort elements by depth to allow them to be self referential.
        elems.sort(function (a, b) { return (a.parent ? a.parent.split("__").length : 0) - (b.parent ? b.parent.split("__").length : 0); });
        var start = now();
        for (var _i = 0; _i < elems.length; _i++) {
            var elem = elems[_i];
            var post = this.prepare(elem);
        }
        var prepare = now();
        var d = this.diff();
        var diff = now();
        this.domify();
        var domify = now();
        this.postDomify();
        var postDomify = now();
        var time = now() - start;
        if (time > 5) {
            console.log("slow render (> 5ms): ", time, {
                prepare: prepare - start,
                diff: diff - prepare,
                domify: domify - diff,
                postDomify: postDomify - domify
            });
        }
    };
    return Renderer;
})();
exports.Renderer = Renderer;

},{}],5:[function(require,module,exports){
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var utils_1 = require("./utils");
var runtime = require("./runtime");
var app_1 = require("./app");
var ParseError = (function (_super) {
    __extends(ParseError, _super);
    function ParseError(message, line, lineIx, charIx, length) {
        if (charIx === void 0) { charIx = 0; }
        if (length === void 0) { length = line && (line.length - charIx); }
        _super.call(this, message);
        this.message = message;
        this.line = line;
        this.lineIx = lineIx;
        this.charIx = charIx;
        this.length = length;
        this.name = "Parse Error";
    }
    ParseError.prototype.toString = function () {
        return (_a = ["\n      ", ": ", "\n      ", "\n      ", "\n      ", "\n    "], _a.raw = ["\n      ", ": ", "\n      ", "\n      ", "\n      ", "\n    "], utils_1.unpad(6)(_a, this.name, this.message, this.lineIx !== undefined ? "On line " + (this.lineIx + 1) + ":" + this.charIx : "", this.line, utils_1.underline(this.charIx, this.length)));
        var _a;
    };
    return ParseError;
})(Error);
function maybe(val) {
    if (val instanceof Error)
        throw Error;
    return val;
}
function readWhile(str, substring, startIx) {
    var endIx = startIx;
    while (str[endIx] === substring)
        endIx++;
    return str.slice(startIx, endIx);
}
function readUntil(str, sentinel, startIx, unsatisfiedErr) {
    var endIx = str.indexOf(sentinel, startIx);
    if (endIx === -1) {
        if (unsatisfiedErr)
            return unsatisfiedErr;
        return str.slice(startIx);
    }
    return str.slice(startIx, endIx);
}
function readUntilAny(str, sentinels, startIx, unsatisfiedErr) {
    var endIx = -1;
    for (var _i = 0; _i < sentinels.length; _i++) {
        var sentinel = sentinels[_i];
        var ix = str.indexOf(sentinel, startIx);
        if (ix === -1 || endIx !== -1 && ix > endIx)
            continue;
        endIx = ix;
    }
    if (endIx === -1) {
        if (unsatisfiedErr)
            return unsatisfiedErr;
        return str.slice(startIx);
    }
    return str.slice(startIx, endIx);
}
function getAlias(line, lineIx, charIx) {
    var alias = utils_1.uuid();
    var aliasIx = line.lastIndexOf("as [");
    if (aliasIx !== -1) {
        alias = readUntil(line, "]", aliasIx + 4, new ParseError("Alias must terminate in a closing ']'", line, lineIx, line.length));
        if (alias instanceof Error)
            return alias;
    }
    else
        aliasIx = undefined;
    return [alias, aliasIx];
}
function maybeCoerceAlias(maybeAlias) {
    if (maybeAlias[0] === "[") {
        if (maybeAlias[maybeAlias.length - 1] !== "]")
            return new Error("Attribute aliases must terminate in a closing ']'");
        var _a = maybeAlias.slice(1, -1).split(","), source = _a[0], attribute = _a[1];
        if (!attribute)
            return new Error("Attribute aliases must contain a source, attribute pair");
        return [source.trim(), attribute.trim()];
    }
    return utils_1.coerceInput(maybeAlias);
}
function getMapArgs(line, lineIx, charIx) {
    var args = {};
    if (line[charIx] === "{") {
        var endIx = line.indexOf("}", charIx);
        if (endIx === -1)
            return [new ParseError("Args must terminate in a closing '}'", line, lineIx, line.length), line.length];
        var syntaxErrorIx = line.indexOf("],");
        if (syntaxErrorIx !== -1)
            return [new ParseError("Args are delimited by ';', not ','", line, lineIx, syntaxErrorIx + 1, 0), charIx];
        for (var _i = 0, _a = line.slice(++charIx, endIx).split(";"); _i < _a.length; _i++) {
            var pair = _a[_i];
            var _b = pair.split(":"), key = _b[0], val = _b[1];
            if (key === undefined || val === undefined)
                return [new ParseError("Args must be specified in key: value pairs", line, lineIx, charIx, pair.length), charIx + pair.length + 1];
            var coerced = args[key.trim()] = maybeCoerceAlias(val.trim());
            if (coerced instanceof Error) {
                var valIx = charIx + pair.indexOf("[");
                return [new ParseError(coerced.message, line, lineIx, valIx), valIx];
            }
            charIx += pair.length + 1;
        }
        return [args, endIx + 1];
    }
    return [undefined, charIx];
}
function getListArgs(line, lineIx, charIx) {
    var args = [];
    if (line[charIx] === "{") {
        var endIx = line.indexOf("}", charIx);
        if (endIx === -1)
            return [new ParseError("Args must terminate in a closing '}'", line, lineIx, line.length), line.length];
        var syntaxErrorIx = line.indexOf("],");
        if (syntaxErrorIx !== -1)
            return [new ParseError("Args are delimited by ';', not ','", line, lineIx, syntaxErrorIx + 1, 0), charIx];
        for (var _i = 0, _a = line.slice(++charIx, endIx).split(";"); _i < _a.length; _i++) {
            var val = _a[_i];
            var coerced = maybeCoerceAlias(val.trim());
            if (coerced instanceof Error) {
                var valIx = charIx + val.indexOf("[");
                return [new ParseError(coerced.message, line, lineIx, valIx), valIx];
            }
            args.push(coerced);
            charIx += alert.length + 1;
        }
        return [args, charIx];
    }
    return [undefined, charIx];
}
function getDeselect(line, lineIx, charIx) {
    var deselect = false;
    if (line[charIx] === "!") {
        deselect = true;
        charIx++;
        while (line[charIx] === " ")
            charIx++;
    }
    return [deselect, charIx];
}
var parsePlanStep = (_a = {},
    _a["#"] = function () {
        return;
    },
    // Sources
    _a.find = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var entity = line.slice(charIx, aliasIx).trim();
        if (!entity)
            return new ParseError("Find step must specify a valid entity id", line, lineIx, charIx);
        var step = { type: "find", id: alias, entity: entity };
        return step;
    },
    _a.gather = function (line, lineIx, charIx, relatedTo) {
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var collection = line.slice(charIx, aliasIx).trim();
        if (!collection)
            return new ParseError("Gather step must specify a valid collection id", line, lineIx, charIx);
        var step = { type: "gather", id: alias, collection: collection, relatedTo: relatedTo };
        return step;
    },
    // Joins
    _a.lookup = function (line, lineIx, charIx, relatedTo) {
        if (!relatedTo)
            return new ParseError("Lookup step must be a child of a root", line, lineIx, charIx);
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var deselect;
        _b = getDeselect(line, lineIx, charIx), deselect = _b[0], charIx = _b[1];
        var attribute = line.slice(charIx, aliasIx).trim();
        if (!attribute)
            return new ParseError("Lookup step must specify a valid attribute id.", line, lineIx, charIx);
        var step = { type: "lookup", id: alias, name: alias, attribute: attribute, deselect: deselect, relatedTo: relatedTo };
        return step;
        var _b;
    },
    _a.intersect = function (line, lineIx, charIx, relatedTo) {
        if (!relatedTo)
            return new ParseError("Lookup step must be a child of a root", line, lineIx, charIx);
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var deselect;
        _b = getDeselect(line, lineIx, charIx), deselect = _b[0], charIx = _b[1];
        var collection = line.slice(charIx, aliasIx).trim();
        if (!collection)
            return new ParseError("Intersect step must specify a valid collection id", line, lineIx, charIx);
        var step = { type: "intersect", id: alias, collection: collection, deselect: deselect, relatedTo: relatedTo };
        return step;
        var _b;
    },
    _a.filterByEntity = function (line, lineIx, charIx, relatedTo) {
        if (!relatedTo)
            return new ParseError("Lookup step must be a child of a root", line, lineIx, charIx);
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var deselect;
        _b = getDeselect(line, lineIx, charIx), deselect = _b[0], charIx = _b[1];
        var entity = line.slice(charIx, aliasIx).trim();
        if (!entity)
            return new ParseError("Intersect step must specify a valid entity id", line, lineIx, charIx, entity.length);
        var step = { type: "filter by entity", id: alias, entity: entity, deselect: deselect, relatedTo: relatedTo };
        return step;
        var _b;
    },
    // Calculations
    _a.filter = function (line, lineIx, charIx) {
        // filter positive
        // filter >; a: 7, b: [person age]
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var lastIx = charIx;
        var filter = readUntil(line, "{", charIx); // @NOTE: Need to remove alias
        charIx += filter.length;
        filter = filter.trim();
        if (!filter)
            return new ParseError("Filter step must specify a valid filter fn", line, lineIx, lastIx);
        var args;
        _b = getMapArgs(line, lineIx, charIx), args = _b[0], charIx = _b[1];
        if (args instanceof Error)
            return args;
        if (line.length > charIx)
            return new ParseError("Filter step contains extraneous text", line, lineIx, charIx);
        var step = { type: "filter", id: alias, func: filter, args: args };
        return step;
        var _b;
    },
    _a.calculate = function (line, lineIx, charIx) {
        // filter positive
        // filter >; a: 7, b: [person age]
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var lastIx = charIx;
        var filter = readUntil(line, "{", charIx); // @NOTE: Need to remove alias
        charIx += filter.length;
        filter = filter.trim();
        if (!filter)
            return new ParseError("Calculate step must specify a valid calculate fn", line, lineIx, lastIx);
        var args;
        _b = getMapArgs(line, lineIx, charIx), args = _b[0], charIx = _b[1];
        if (args instanceof Error)
            return args;
        var step = { type: "calculate", id: alias, func: filter, args: args };
        return step;
        var _b;
    },
    _a
);
function parsePlan(str) {
    var plan = [];
    var errors = [];
    var lineIx = 0;
    var lines = str.split("\n");
    var stack = [];
    for (var _i = 0; _i < lines.length; _i++) {
        var line = lines[_i];
        var charIx = 0;
        while (line[charIx] === " ")
            charIx++;
        var indent = charIx;
        if (line[charIx] === undefined)
            continue;
        var related = void 0;
        for (var stackIx = stack.length - 1; stackIx >= 0; stackIx--) {
            if (indent > stack[stackIx].indent) {
                related = stack[stackIx].step;
                break;
            }
            else
                stack.pop();
        }
        var keyword = readUntil(line, " ", charIx);
        charIx += keyword.length;
        var step = void 0;
        if (parsePlanStep[keyword])
            step = parsePlanStep[keyword](line, lineIx, charIx, related);
        else
            step = new ParseError("Keyword '" + keyword + "' is not a valid plan step, ignoring", line, lineIx, charIx - keyword.length, keyword.length);
        if (step && step["args"]) {
            var args = step["args"];
            for (var arg in args) {
                if (args[arg] instanceof Array) {
                    var source = args[arg][0];
                    var valid = false;
                    for (var _a = 0; _a < plan.length; _a++) {
                        var step_1 = plan[_a];
                        if (step_1.id === source) {
                            valid = true;
                            break;
                        }
                    }
                    if (!valid) {
                        step = new ParseError("Alias source '" + source + "' does not exist in plan", line, lineIx, line.indexOf("[" + source + ",") + 1, source.length);
                    }
                }
            }
        }
        if (step instanceof Error)
            errors.push(step);
        else if (step) {
            plan.push(step);
            stack.push({ indent: indent, step: step });
        }
        lineIx++;
    }
    if (errors.length) {
        for (var _b = 0; _b < errors.length; _b++) {
            var err = errors[_b];
            console.error(err);
        }
    }
    return plan;
}
exports.parsePlan = parsePlan;
var parseQueryStep = (_b = {},
    _b["#"] = function () {
        return;
    },
    _b.select = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var lastIx = charIx;
        var viewRaw = readUntil(line, "{", charIx).slice(0, aliasIx ? aliasIx - charIx : undefined);
        charIx += viewRaw.length;
        var view = viewRaw.trim();
        if (!view)
            return new ParseError("Select step must specify a valid view id", line, lineIx, lastIx, viewRaw.length);
        var join;
        _b = getMapArgs(line, lineIx, charIx), join = _b[0], charIx = _b[1];
        if (join instanceof Error)
            return join;
        var step = { type: "select", id: alias, view: view, join: join };
        return step;
        var _b;
    },
    _b.deselect = function (line, lineIx, charIx) {
        var step = parseQueryStep["select"](line, lineIx, charIx);
        if (step instanceof Error)
            return step;
        step.type = "deselect";
        return step;
    },
    _b.calculate = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var _a = getAlias(line, lineIx, charIx), alias = _a[0], aliasIx = _a[1];
        var lastIx = charIx;
        var funcRaw = readUntil(line, "{", charIx).slice(0, aliasIx ? aliasIx - charIx : undefined);
        charIx += funcRaw.length;
        var func = funcRaw.trim();
        if (!func)
            return new ParseError("Calculate step must specify a valid function id", line, lineIx, lastIx, funcRaw.length);
        var args;
        _b = getMapArgs(line, lineIx, charIx), args = _b[0], charIx = _b[1];
        if (args instanceof Error)
            return args;
        var step = { type: "calculate", id: alias, func: func, args: args };
        return step;
        var _b;
    },
    _b.aggregate = function (line, lineIx, charIx) {
        var step = parseQueryStep["calculate"](line, lineIx, charIx);
        if (step instanceof Error)
            return step;
        step.type = "aggregate";
        return step;
    },
    _b.ordinal = function (line, lineIx, charIx) {
        var step = { type: "ordinal" };
        return step;
    },
    _b.group = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var groups;
        _a = getListArgs(line, lineIx, charIx), groups = _a[0], charIx = _a[1];
        if (groups instanceof Error)
            return groups;
        var step = { type: "group", groups: groups };
        return step;
        var _a;
    },
    _b.sort = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var sorts;
        _a = getListArgs(line, lineIx, charIx), sorts = _a[0], charIx = _a[1];
        if (sorts instanceof Error)
            return sorts;
        var step = { type: "sort", sorts: sorts };
        return step;
        var _a;
    },
    _b.limit = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var args;
        _a = getMapArgs(line, lineIx, charIx), args = _a[0], charIx = _a[1];
        if (args instanceof Error)
            return args;
        for (var _i = 0, _b = Object.keys(args); _i < _b.length; _i++) {
            var key = _b[_i];
            if (key !== "results" && key !== "perGroup")
                return new ParseError("Limit may only apply perGroup or to results", line, lineIx, charIx);
        }
        var step = { type: "limit", limit: args };
        return step;
        var _a;
    },
    _b.project = function (line, lineIx, charIx) {
        while (line[charIx] === " ")
            charIx++;
        var args;
        _a = getMapArgs(line, lineIx, charIx), args = _a[0], charIx = _a[1];
        if (args instanceof Error)
            return args;
        var step = { type: "project", mapping: args };
        return step;
        var _a;
    },
    _b
);
function parseQuery(str) {
    var plan = [];
    var errors = [];
    var lineIx = 0;
    var lines = str.split("\n");
    for (var _i = 0; _i < lines.length; _i++) {
        var line = lines[_i];
        var charIx = 0;
        while (line[charIx] === " ")
            charIx++;
        if (line[charIx] === undefined)
            continue;
        var keyword = readUntil(line, " ", charIx);
        charIx += keyword.length;
        var step = void 0;
        if (parseQueryStep[keyword])
            step = parseQueryStep[keyword](line, lineIx, charIx);
        else
            step = new ParseError("Keyword '" + keyword + "' is not a valid query step, ignoring", line, lineIx, charIx - keyword.length, keyword.length);
        if (step && step["args"]) {
            var args = step["args"];
            for (var arg in args) {
                if (args[arg] instanceof Array) {
                    var source = args[arg][0];
                    var valid = false;
                    for (var _a = 0; _a < plan.length; _a++) {
                        var step_2 = plan[_a];
                        if (step_2.id === source) {
                            valid = true;
                            break;
                        }
                    }
                    if (!valid) {
                        step = new ParseError("Alias source '" + source + "' does not exist in query", line, lineIx, line.indexOf("[" + source + ",") + 1, source.length);
                    }
                }
            }
        }
        if (step instanceof Error)
            errors.push(step);
        else if (step)
            plan.push(step);
        lineIx++;
    }
    if (errors.length) {
        // @FIXME: Return errors instead of logging them.
        for (var _b = 0; _b < errors.length; _b++) {
            var err = errors[_b];
            console.error(err.toString());
        }
    }
    return plan;
}
exports.parseQuery = parseQuery;
function parseUI(str) {
    var root = {};
    var errors = [];
    var lineIx = 0;
    var lines = str.split("\n");
    var stack = [{ indent: -2, elem: root }];
    // @FIXME: Chunk into element chunks instead of lines to enable in-argument continuation.
    for (var _i = 0; _i < lines.length; _i++) {
        var line = lines[_i];
        var charIx = 0;
        while (line[charIx] === " ")
            charIx++;
        var indent = charIx;
        if (line[charIx] === undefined)
            continue;
        var parent_1 = void 0;
        for (var stackIx = stack.length - 1; stackIx >= 0; stackIx--) {
            if (indent > stack[stackIx].indent) {
                parent_1 = stack[stackIx].elem;
                break;
            }
            else
                stack.pop();
        }
        var keyword = readUntil(line, " ", charIx);
        charIx += keyword.length;
        if (keyword[0] === "~" || keyword[0] === "%") {
            charIx -= keyword.length - 1;
            var kind = keyword[0] === "~" ? "plan" : "query";
            if (!parent_1.binding) {
                parent_1.binding = line.slice(charIx);
                parent_1.bindingKind = kind;
            }
            else if (kind === parent_1.bindingKind)
                parent_1.binding += "\n" + line.slice(charIx);
            else {
                errors.push(new ParseError("UI must be bound to a single type of query.", line, lineIx));
                continue;
            }
            charIx = line.length;
        }
        else if (keyword[0] === "@") {
            charIx -= keyword.length - 1;
            var err = void 0;
            while (line[charIx] === " ")
                charIx++;
            var lastIx = charIx;
            var eventRaw = readUntil(line, "{", charIx);
            charIx += eventRaw.length;
            var event_1 = eventRaw.trim();
            if (!event_1)
                err = new ParseError("UI event must specify a valid event name", line, lineIx, lastIx, eventRaw.length);
            var state = void 0;
            _a = getMapArgs(line, lineIx, charIx), state = _a[0], charIx = _a[1];
            if (state instanceof Error && !err)
                err = state;
            if (err) {
                errors.push(err);
                lineIx++;
                continue;
            }
            if (!parent_1.events)
                parent_1.events = {};
            parent_1.events[event_1] = state;
        }
        else if (keyword[0] === ">") {
            charIx -= keyword.length - 1;
            var err = void 0;
            while (line[charIx] === " ")
                charIx++;
            var lastIx = charIx;
            var embedIdRaw = readUntil(line, "{", charIx);
            charIx += embedIdRaw.length;
            var embedId = embedIdRaw.trim();
            if (!embedId)
                err = new ParseError("UI embed must specify a valid element id", line, lineIx, lastIx, embedIdRaw.length);
            var scope = void 0;
            _b = getMapArgs(line, lineIx, charIx), _c = _b[0], scope = _c === void 0 ? {} : _c, charIx = _b[1];
            if (scope instanceof Error && !err)
                err = scope;
            if (err) {
                errors.push(err);
                lineIx++;
                continue;
            }
            var elem = { embedded: scope, id: embedId };
            if (!parent_1.children)
                parent_1.children = [];
            parent_1.children.push(elem);
            stack.push({ indent: indent, elem: elem });
        }
        else {
            var err = void 0;
            if (!keyword)
                err = new ParseError("UI element must specify a valid tag name", line, lineIx, charIx, 0);
            while (line[charIx] === " ")
                charIx++;
            var classesRaw = readUntil(line, "{", charIx);
            charIx += classesRaw.length;
            var classes = classesRaw.trim();
            var attributes = void 0;
            _d = getMapArgs(line, lineIx, charIx), _e = _d[0], attributes = _e === void 0 ? {} : _e, charIx = _d[1];
            if (attributes instanceof Error && !err)
                err = attributes;
            if (err) {
                errors.push(err);
                lineIx++;
                continue;
            }
            attributes["t"] = keyword;
            if (classes)
                attributes["c"] = classes;
            var elem = { id: attributes["id"], attributes: attributes };
            if (!parent_1.children)
                parent_1.children = [];
            parent_1.children.push(elem);
            stack.push({ indent: indent, elem: elem });
        }
        lineIx++;
    }
    if (errors.length) {
        for (var _f = 0; _f < errors.length; _f++) {
            var err = errors[_f];
            console.error(err);
        }
    }
    return root;
    var _a, _b, _c, _d, _e;
}
exports.parseUI = parseUI;
//-----------------------------------------------------------------------------
// Eve DSL Parser
//-----------------------------------------------------------------------------
var TOKEN_TYPE;
(function (TOKEN_TYPE) {
    TOKEN_TYPE[TOKEN_TYPE["EXPR"] = 0] = "EXPR";
    TOKEN_TYPE[TOKEN_TYPE["IDENTIFIER"] = 1] = "IDENTIFIER";
    TOKEN_TYPE[TOKEN_TYPE["KEYWORD"] = 2] = "KEYWORD";
    TOKEN_TYPE[TOKEN_TYPE["STRING"] = 3] = "STRING";
    TOKEN_TYPE[TOKEN_TYPE["LITERAL"] = 4] = "LITERAL";
})(TOKEN_TYPE || (TOKEN_TYPE = {}));
;
var Token = (function () {
    function Token(type, value, lineIx, charIx) {
        this.type = type;
        this.value = value;
        this.lineIx = lineIx;
        this.charIx = charIx;
    }
    Token.identifier = function (value, lineIx, charIx) {
        return new Token(Token.TYPE.IDENTIFIER, value, lineIx, charIx);
    };
    Token.keyword = function (value, lineIx, charIx) {
        return new Token(Token.TYPE.KEYWORD, value, lineIx, charIx);
    };
    Token.string = function (value, lineIx, charIx) {
        return new Token(Token.TYPE.STRING, value, lineIx, charIx);
    };
    Token.literal = function (value, lineIx, charIx) {
        return new Token(Token.TYPE.LITERAL, value, lineIx, charIx);
    };
    Token.prototype.toString = function () {
        if (this.type === Token.TYPE.KEYWORD)
            return ":" + this.value;
        else if (this.type === Token.TYPE.STRING)
            return "\"" + this.value + "\"";
        else
            return this.value.toString();
    };
    Token.TYPE = TOKEN_TYPE;
    return Token;
})();
exports.Token = Token;
var Sexpr = (function () {
    function Sexpr(val, lineIx, charIx, syntax) {
        if (syntax === void 0) { syntax = "expr"; }
        this.lineIx = lineIx;
        this.charIx = charIx;
        this.syntax = syntax;
        this.type = Token.TYPE.EXPR;
        if (val)
            this.value = val.slice();
    }
    Sexpr.list = function (value, lineIx, charIx, syntax) {
        if (value === void 0) { value = []; }
        value = value.slice();
        value.unshift(Token.identifier("list", lineIx, charIx ? charIx + 1 : undefined));
        return new Sexpr(value, lineIx, charIx, syntax ? "list" : undefined);
    };
    Sexpr.hash = function (value, lineIx, charIx, syntax) {
        if (value === void 0) { value = []; }
        value = value.slice();
        value.unshift(Token.identifier("hash", lineIx, charIx ? charIx + 1 : undefined));
        return new Sexpr(value, lineIx, charIx, syntax ? "hash" : undefined);
    };
    Sexpr.asSexprs = function (values) {
        for (var _i = 0; _i < values.length; _i++) {
            var raw = values[_i];
            if (!(raw instanceof Sexpr))
                throw new ParseError("All top level entries must be expressions (got " + raw + ")", undefined, raw.lineIx, raw.charIx);
            else {
                var op = raw.operator;
                if (op.type !== Token.TYPE.IDENTIFIER)
                    throw new ParseError("All expressions must begin with an identifier", undefined, raw.lineIx, raw.charIx);
            }
        }
        return values;
    };
    Sexpr.prototype.toString = function () {
        var content = this.value && this.value.map(function (token) { return token.toString(); }).join(" ");
        var argsContent = this.value && this.arguments.map(function (token) { return token.toString(); }).join(" ");
        if (this.syntax === "hash")
            return "{" + argsContent + "}";
        else if (this.syntax === "list")
            return "[" + argsContent + "]";
        else
            return "(" + content + ")";
    };
    Sexpr.prototype.push = function (val) {
        this.value = this.value || [];
        return this.value.push(val);
    };
    Sexpr.prototype.nth = function (n, val) {
        if (val) {
            this.value = this.value || [];
            return this.value[n] = val;
        }
        return this.value && this.value[n];
    };
    Object.defineProperty(Sexpr.prototype, "operator", {
        get: function () {
            return this.value && this.value[0];
        },
        set: function (op) {
            this.value = this.value || [];
            this.value[0] = op;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Sexpr.prototype, "arguments", {
        get: function () {
            return this.value && this.value.slice(1);
        },
        set: function (args) {
            this.value = this.value || [];
            this.value.length = 1;
            this.value.push.apply(this.value, args);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Sexpr.prototype, "length", {
        get: function () {
            return this.value && this.value.length;
        },
        enumerable: true,
        configurable: true
    });
    return Sexpr;
})();
exports.Sexpr = Sexpr;
var TOKEN_TO_TYPE = {
    "(": "expr",
    ")": "expr",
    "[": "list",
    "]": "list",
    "{": "hash",
    "}": "hash"
};
var hygienicSymbolCounter = 0;
function readSexprs(text) {
    var root = Sexpr.list();
    var token;
    var sexpr = root;
    var sexprs = [root];
    var lines = text.split("\n");
    var lineIx = 0;
    var mode;
    for (var _i = 0; _i < lines.length; _i++) {
        var line = lines[_i];
        var line_1 = lines[lineIx];
        var charIx = 0;
        if (mode === "string")
            token.value += "\n";
        while (charIx < line_1.length) {
            if (mode === "string") {
                if (line_1[charIx] === "\"" && line_1[charIx - 1] !== "\\") {
                    sexpr.push(token);
                    token = mode = undefined;
                    charIx++;
                }
                else
                    token.value += line_1[charIx++];
                continue;
            }
            var padding = readWhile(line_1, " ", charIx);
            charIx += padding.length;
            if (padding.length) {
                if (token)
                    sexpr.push(token);
                token = undefined;
            }
            if (charIx >= line_1.length)
                continue;
            if (line_1[charIx] === ";") {
                charIx = line_1.length;
            }
            else if (line_1[charIx] === "\"") {
                if (!sexpr.length)
                    throw new ParseError("Literal must be an argument in a sexpr.", line_1, lineIx, charIx);
                mode = "string";
                token = Token.string("", lineIx, charIx);
                charIx++;
            }
            else if (line_1[charIx] === ":") {
                if (!sexpr.length)
                    throw new ParseError("Literal must be an argument in a sexpr.", line_1, lineIx, charIx);
                var keyword = readUntilAny(line_1, [" ", ")", "]", "}"], ++charIx);
                sexpr.push(Token.keyword(keyword, lineIx, charIx - 1));
                charIx += keyword.length;
            }
            else if (line_1[charIx] === "(" || line_1[charIx] === "[" || line_1[charIx] === "{") {
                if (token)
                    throw new ParseError("Sexpr arguments must be space separated.", line_1, lineIx, charIx);
                var type = TOKEN_TO_TYPE[line_1[charIx]];
                if (type === "hash")
                    sexpr = Sexpr.hash(undefined, lineIx, charIx);
                else if (type === "list")
                    sexpr = Sexpr.list(undefined, lineIx, charIx);
                else
                    sexpr = new Sexpr(undefined, lineIx, charIx);
                sexpr.syntax = type;
                sexprs.push(sexpr);
                charIx++;
            }
            else if (line_1[charIx] === ")" || line_1[charIx] === "]" || line_1[charIx] === "}") {
                var child = sexprs.pop();
                var type = TOKEN_TO_TYPE[line_1[charIx]];
                if (child.syntax !== type)
                    throw new ParseError("Must terminate " + child.syntax + " before terminating " + type, line_1, lineIx, charIx);
                sexpr = sexprs[sexprs.length - 1];
                if (!sexpr)
                    throw new ParseError("Too many closing parens", line_1, lineIx, charIx);
                sexpr.push(child);
                charIx++;
            }
            else {
                var literal = readUntilAny(line_1, [" ", ")", "]", "}"], charIx);
                var length_1 = literal.length;
                literal = utils_1.coerceInput(literal);
                var type = typeof literal === "string" ? "identifier" : "literal";
                if (!sexpr.length && type !== "identifier")
                    throw new ParseError("Expr must begin with identifier.", line_1, lineIx, charIx);
                if (type === "identifier") {
                    var dotIx = literal.indexOf(".");
                    if (dotIx !== -1) {
                        var child = new Sexpr([
                            Token.identifier("get", lineIx, charIx + 1),
                            Token.identifier(literal.slice(0, dotIx), lineIx, charIx + 3),
                            Token.string(literal.slice(dotIx + 1), lineIx, charIx + 5 + dotIx)
                        ], lineIx, charIx);
                        sexpr.push(child);
                    }
                    else
                        sexpr.push(Token.identifier(literal, lineIx, charIx));
                }
                else
                    sexpr.push(Token.literal(literal, lineIx, charIx));
                charIx += length_1;
            }
        }
        lineIx++;
    }
    if (token)
        throw new ParseError("Unterminated " + TOKEN_TYPE[token.type] + " token", lines[lineIx - 1], lineIx - 1);
    var lastIx = lines.length - 1;
    if (sexprs.length > 1)
        throw new ParseError("Too few closing parens", lines[lastIx], lastIx, lines[lastIx].length);
    return root;
}
exports.readSexprs = readSexprs;
function macroexpandDSL(sexpr) {
    // @TODO: Implement me.
    var op = sexpr.operator;
    if (op.value === "eav") {
        throw new Error("@TODO: Implement me!");
    }
    else if (op.value === "one-of") {
        // (one-of (query ...body) (query ...body) ...) =>
        // (union
        //   (def q1 (query ...body1))
        //   (def q2 (query (negate q1) ...body2)))
        throw new Error("@TODO: Implement me!");
    }
    else if (op.value === "negate") {
        if (sexpr.length > 2)
            throw new ParseError("Negate only take a single body", undefined, sexpr.lineIx, sexpr.charIx);
        var select = macroexpandDSL(Sexpr.asSexprs(sexpr.arguments)[0]);
        select.push(Token.keyword("$$negated"));
        select.push(Token.literal(true));
        return select;
    }
    else if (["hash", "list", "get", "def", "query", "union", "select", "member", "project!", "insert!", "remove!", "load!"].indexOf(op.value) === -1) {
        // (foo-bar :a 5) => (select "foo bar" :a 5)
        var source = op;
        source.type = Token.TYPE.STRING;
        source.value = source.value.replace(/(.?)-(.)/g, "$1 $2");
        var args = sexpr.arguments;
        args.unshift(source);
        sexpr.arguments = args;
        sexpr.operator = Token.identifier("select");
    }
    return sexpr;
}
exports.macroexpandDSL = macroexpandDSL;
var VALUE;
(function (VALUE) {
    VALUE[VALUE["NULL"] = 0] = "NULL";
    VALUE[VALUE["SCALAR"] = 1] = "SCALAR";
    VALUE[VALUE["SET"] = 2] = "SET";
    VALUE[VALUE["VIEW"] = 3] = "VIEW";
})(VALUE || (VALUE = {}));
;
function parseDSL(text) {
    var artifacts = { views: {} };
    var lines = text.split("\n");
    var root = readSexprs(text);
    for (var _i = 0, _a = Sexpr.asSexprs(root.arguments); _i < _a.length; _i++) {
        var raw = _a[_i];
        parseDSLSexpr(raw, artifacts);
    }
    return artifacts;
}
exports.parseDSL = parseDSL;
var primitives = {
    "+": "calculate",
    "-": "calculate",
    "*": "calculate",
    "/": "calculate",
    "=": "filter",
    "<": "filter",
    "<=": "filter",
    "sum": "aggregate",
    "count": "aggregate",
    "max": "aggregate"
};
function parseDSLSexpr(raw, artifacts, context, parent, resultVariable) {
    if (parent instanceof runtime.Query)
        var query = parent;
    else
        var union = parent;
    var sexpr = macroexpandDSL(raw);
    var op = sexpr.operator;
    if (op.type !== Token.TYPE.IDENTIFIER)
        throw new ParseError("Evaluated sexpr must begin with an identifier ('" + op + "' is a " + Token.TYPE[op.type] + ")", "", raw.lineIx, raw.charIx);
    if (op.value === "list") {
        var $$body = parseArguments(sexpr, undefined, "$$body").$$body;
        return { type: VALUE.SCALAR, value: $$body.map(function (token, ix) { return resolveTokenValue("list item " + ix, token, context); }) };
    }
    if (op.value === "hash") {
        var args = parseArguments(sexpr);
        for (var arg in args)
            args[arg] = resolveTokenValue("hash item " + arg, args[arg], context);
        return { type: VALUE.SET, value: args };
    }
    if (op.value === "insert!") {
        var changeset = artifacts.changeset || app_1.eve.diff();
        for (var _i = 0, _a = sexpr.arguments; _i < _a.length; _i++) {
            var arg = _a[_i];
            var table = arg.value[0];
            var fact = {};
            for (var ix = 1; ix < arg.value.length; ix += 2) {
                var key = arg.value[ix];
                var value = arg.value[ix + 1];
                fact[key.value] = value.value;
            }
            changeset.add(table.value, fact);
        }
        artifacts.changeset = changeset;
        return;
    }
    if (op.value === "remove!") {
        var changeset = artifacts.changeset || app_1.eve.diff();
        for (var _b = 0, _c = sexpr.arguments; _b < _c.length; _b++) {
            var arg = _c[_b];
            var table = arg.value[0];
            var fact = {};
            for (var ix = 1; ix < arg.value.length; ix += 2) {
                var key = arg.value[ix];
                var value = arg.value[ix + 1];
                fact[key.value] = value.value;
            }
            changeset.remove(table.value, fact);
        }
        artifacts.changeset = changeset;
        return;
    }
    if (op.value === "load!") {
        throw new Error("(load! ..) has not been implemented yet");
    }
    if (op.value === "query") {
        var neueContext = [];
        var _d = parseArguments(sexpr, undefined, "$$body"), $$view = _d.$$view, $$negated = _d.$$negated, $$body = _d.$$body;
        var queryId = $$view ? resolveTokenValue("view", $$view, context, VALUE.SCALAR) : utils_1.uuid();
        var neue = new runtime.Query(app_1.eve, queryId);
        if (utils_1.DEBUG.instrumentQuery)
            instrumentQuery(neue, utils_1.DEBUG.instrumentQuery);
        artifacts.views[queryId] = neue;
        var aggregated = false;
        for (var _e = 0, _f = Sexpr.asSexprs($$body); _e < _f.length; _e++) {
            var raw_1 = _f[_e];
            var state = parseDSLSexpr(raw_1, artifacts, neueContext, neue);
            if (state && state.aggregated)
                aggregated = true;
        }
        var projectionMap = neue.projectionMap;
        var projected = true;
        if (!projectionMap) {
            projectionMap = {};
            projected = false;
            for (var _g = 0; _g < neueContext.length; _g++) {
                var variable = neueContext[_g];
                projectionMap[variable.name] = variable.value;
            }
        }
        if (Object.keys(projectionMap).length)
            neue.project(projectionMap);
        // Join subquery to parent.
        if (parent) {
            var select = new Sexpr([Token.identifier(query ? "select" : "member"), Token.string(queryId)], raw.lineIx, raw.charIx);
            var groups = [];
            for (var _h = 0; _h < neueContext.length; _h++) {
                var variable = neueContext[_h];
                if (projected && !variable.projection)
                    continue;
                var field = variable.projection || variable.name;
                select.push(Token.keyword(field));
                if (query)
                    select.push(Token.identifier(variable.name));
                else
                    select.push(Sexpr.list([Token.string(field)]));
                if (context) {
                    for (var _j = 0; _j < context.length; _j++) {
                        var parentVar = context[_j];
                        if (parentVar.name === variable.name)
                            groups.push(variable.value);
                    }
                }
            }
            if ($$negated) {
                select.push(Token.keyword("$$negated"));
                select.push($$negated);
            }
            if (groups.length && aggregated)
                neue.group(groups);
            parseDSLSexpr(select, artifacts, context, parent);
        }
        return { value: queryId, type: VALUE.VIEW, projected: projected, context: neueContext };
    }
    if (op.value === "union") {
        var _k = parseArguments(sexpr, undefined, "$$body"), $$view = _k.$$view, $$body = _k.$$body, $$negated = _k.$$negated;
        var unionId = $$view ? resolveTokenValue("view", $$view, context, VALUE.SCALAR) : utils_1.uuid();
        var neue = new runtime.Union(app_1.eve, unionId);
        if (utils_1.DEBUG.instrumentQuery)
            instrumentQuery(neue, utils_1.DEBUG.instrumentQuery);
        artifacts.views[unionId] = neue;
        var mappings = {};
        for (var _l = 0, _m = Sexpr.asSexprs($$body); _l < _m.length; _l++) {
            var raw_2 = _m[_l];
            var child = macroexpandDSL(raw_2);
            if (child.operator.value !== "query" && child.operator.value !== "union")
                throw new ParseError("Unions may only contain queries", "", raw_2.lineIx, raw_2.charIx);
            var res = parseDSLSexpr(child, artifacts, context, neue);
            for (var _o = 0, _p = res.context; _o < _p.length; _o++) {
                var variable = _p[_o];
                if (res.projected && !variable.projection)
                    continue;
                var field = variable.projection || variable.name;
                if (!mappings[field])
                    mappings[field] = {};
                mappings[field][variable.name] = true;
            }
        }
        // Join subunion to parent
        if (parent) {
            var select = new Sexpr([Token.identifier(query ? "select" : "member"), Token.string(unionId)], raw.lineIx, raw.charIx);
            for (var field in mappings) {
                var mappingVariables = Object.keys(mappings[field]);
                if (mappingVariables.length > 1)
                    throw new ParseError("All variables projected to a single union field must have the same name. Field '" + field + "' has " + mappingVariables.length + " fields (" + mappingVariables.join(", ") + ")", "", raw.lineIx, raw.charIx);
                select.push(Token.keyword(field));
                select.push(Token.identifier(mappingVariables[0]));
            }
            console.log("union select", select.toString());
            parseDSLSexpr(select, artifacts, context, parent);
        }
        return { type: VALUE.VIEW, value: unionId, mappings: mappings };
    }
    if (op.value === "member") {
        if (!union)
            throw new ParseError("Cannot add member to non-union parent", "", raw.lineIx, raw.charIx);
        var args = parseArguments(sexpr, ["$$view"]);
        var $$view = args.$$view, $$negated = args.$$negated;
        var view = resolveTokenValue("view", $$view, context, VALUE.SCALAR);
        if (view === undefined)
            throw new ParseError("Must specify a view to be unioned", "", raw.lineIx, raw.charIx);
        var join = {};
        for (var arg in args) {
            if (arg === "$$view" || arg === "$$negated")
                continue;
            join[arg] = resolveTokenValue("member field", args[arg], context);
        }
        if (primitives[view])
            throw new ParseError("Cannot union primitive view '" + view + "'", "", raw.lineIx, raw.charIx);
        union.union(view, join);
        return;
    }
    if (!parent)
        throw new ParseError("Non-query or union sexprs must be contained within a query or union", "", raw.lineIx, raw.charIx);
    if (op.value === "select") {
        if (!query)
            throw new ParseError("Cannot add select to non-query parent", "", raw.lineIx, raw.charIx);
        var selectId = utils_1.uuid();
        var $$view = getArgument(sexpr, "$$view", ["$$view"]);
        var view = resolveTokenValue("view", $$view, context, VALUE.SCALAR);
        if (view === undefined)
            throw new ParseError("Must specify a view to be selected", "", raw.lineIx, raw.charIx);
        //@TODO: Move this to an eve table to allow user defined defaults
        var args = parseArguments(sexpr, ["$$view"].concat(getDefaults(view)));
        var $$negated = args.$$negated;
        var join = {};
        for (var arg in args) {
            var value = args[arg];
            var variable = void 0;
            if (arg === "$$view" || arg === "$$negated")
                continue;
            if (value instanceof Token && value.type !== Token.TYPE.IDENTIFIER) {
                join[arg] = args[arg].value;
                continue;
            }
            if (value instanceof Sexpr) {
                var result = parseDSLSexpr(value, artifacts, context, parent, "$$temp-" + hygienicSymbolCounter++ + "-" + arg);
                if (!result || result.type === VALUE.NULL)
                    throw new Error("Cannot set parameter '" + arg + "' to null value '" + value.toString() + "'");
                if (result.type === VALUE.VIEW) {
                    var view_1 = result.value;
                    var resultField_1 = getResult(view_1);
                    if (!resultField_1)
                        throw new Error("Cannot set parameter '" + arg + "' to select without default result field");
                    for (var _q = 0; _q < context.length; _q++) {
                        var curVar = context[_q];
                        for (var _r = 0, _s = curVar.constraints; _r < _s.length; _r++) {
                            var constraint = _s[_r];
                            if (constraint[0] === view_1 && constraint[1] === resultField_1) {
                                variable = curVar;
                                break;
                            }
                        }
                    }
                }
            }
            else
                variable = getDSLVariable(value.value, context);
            if (variable) {
                join[arg] = variable.value;
                variable.constraints.push([view, arg]);
            }
            else if ($$negated && $$negated.value)
                throw new ParseError("Cannot bind field in negated select to undefined variable '" + value.value + "'", "", raw.lineIx, raw.charIx);
            else
                context.push({ name: value.value, type: VALUE.SCALAR, value: [selectId, arg], constraints: [[view, arg]] }); // @TODO: does this not need to add to the join map?
        }
        var resultField = getResult(view);
        if (resultVariable && resultField && !join[resultField]) {
            join[resultField] = [selectId, resultField];
            context.push({ name: resultVariable, type: VALUE.SCALAR, value: [selectId, resultField], constraints: [[view, resultField]] });
        }
        if (primitives[view]) {
            if (primitives[view] === "aggregate")
                query.aggregate(view, join, selectId);
            else
                query.calculate(view, join, selectId);
        }
        else if ($$negated)
            query.deselect(view, join);
        else
            query.select(view, join, selectId);
        return {
            type: VALUE.VIEW,
            value: view,
            aggregated: primitives[view] === "aggregate"
        };
    }
    if (op.value === "project!") {
        var args = parseArguments(sexpr, ["$$view"]);
        var $$view = args.$$view, $$negated = args.$$negated;
        var projectionMap = {};
        for (var arg in args) {
            var value = args[arg];
            if (arg === "$$view" || arg === "$$negated")
                continue;
            if (value.type !== Token.TYPE.IDENTIFIER) {
                projectionMap[arg] = args[arg].value;
                continue;
            }
            var variable = getDSLVariable(value.value, context);
            if (variable) {
                if (variable.static)
                    projectionMap[arg] = variable.value;
                else if (!$$view) {
                    variable.projection = arg;
                    projectionMap[arg] = variable.value;
                }
                else
                    projectionMap[arg] = [variable.name];
            }
            else
                throw new ParseError("Cannot bind projected field to undefined variable '" + value.value + "'", "", raw.lineIx, raw.charIx);
        }
        var view = resolveTokenValue("view", $$view, context, VALUE.SCALAR);
        if (view === undefined) {
            if (query.projectionMap)
                throw new ParseError("Query can only self-project once", "", raw.lineIx, raw.charIx);
            if ($$negated && $$negated.value)
                throw new ParseError("Cannot negate self-projection", "", raw.lineIx, raw.charIx);
            // Project self
            query.project(projectionMap);
        }
        else {
            var union_1 = artifacts.views[view] || new runtime.Union(app_1.eve, view);
            if (utils_1.DEBUG.instrumentQuery && !artifacts.views[view])
                instrumentQuery(union_1, utils_1.DEBUG.instrumentQuery);
            artifacts.views[view] = union_1;
            // if($$negated && $$negated.value) union.ununion(queryId, projectionMap);
            if ($$negated && $$negated.value)
                throw new ParseError("Union projections may not be negated in the current runtime", "", raw.lineIx, raw.charIx);
            else
                union_1.union(query.name, projectionMap);
        }
        return;
    }
    throw new ParseError("Unknown DSL operator '" + op.value + "'", "", raw.lineIx, raw.charIx);
}
function resolveTokenValue(name, token, context, type) {
    if (!token)
        return;
    if (token instanceof Sexpr)
        return parseDSLSexpr(token, undefined, context);
    if (token instanceof Token && token.type === Token.TYPE.IDENTIFIER) {
        var variable = getDSLVariable(token.value, context, VALUE.SCALAR);
        if (!variable)
            throw new Error("Cannot bind " + name + " to undefined variable '" + token.value + "'");
        if (!variable.static)
            throw new Error("Cannot bind " + name + " to dynamic variable '" + token.value + "'");
        return variable.value;
    }
    return token.value;
}
function getDSLVariable(name, context, type) {
    if (!context)
        return;
    for (var _i = 0; _i < context.length; _i++) {
        var variable = context[_i];
        if (variable.name === name) {
            if (variable.static === false)
                throw new Error("Cannot statically look up dynamic variable '" + name + "'");
            if (type !== undefined && variable.type !== type)
                throw new Error("Expected variable '" + name + "' to have type '" + type + "', but instead has type '" + variable.type + "'");
            return variable;
        }
    }
}
function getDefaults(view) {
    return (runtime.QueryFunctions[view] && runtime.QueryFunctions[view].params) || [];
}
function getResult(view) {
    return runtime.QueryFunctions[view] && runtime.QueryFunctions[view].result;
}
function getArgument(root, param, defaults) {
    var ix = 1;
    var defaultIx = 0;
    for (var ix_1 = 1, cur = root.nth(ix_1); ix_1 < root.length; ix_1++) {
        if (cur.type === Token.TYPE.KEYWORD) {
            if (cur.value === param)
                return root.nth(ix_1 + 1);
            else
                ix_1 + 1;
        }
        else {
            if (defaults && defaultIx < defaults.length) {
                var keyword = defaults[defaultIx++];
                if (keyword === param)
                    return cur;
                else
                    ix_1 + 1;
            }
            throw new Error("Param '" + param + "' not in sexpr " + root.toString());
        }
    }
    throw new Error("Param '" + param + "' not in sexpr " + root.toString());
}
exports.getArgument = getArgument;
function parseArguments(root, defaults, rest) {
    var args = {};
    var defaultIx = 0;
    var keyword;
    var kwarg = false;
    for (var _i = 0, _a = root.arguments; _i < _a.length; _i++) {
        var raw = _a[_i];
        if (raw.type === Token.TYPE.KEYWORD) {
            if (keyword)
                throw new Error("Keywords may not be values '" + raw + "'");
            else
                keyword = raw.value;
        }
        else if (keyword) {
            if (args[keyword] === undefined) {
                args[keyword] = raw;
            }
            else {
                if (!(args[keyword] instanceof Array))
                    args[keyword] = [args[keyword]];
                args[keyword].push(raw);
            }
            keyword = undefined;
            defaultIx = defaults ? defaults.length : 0;
            kwarg = true;
        }
        else if (defaults && defaultIx < defaults.length) {
            args[defaults[defaultIx++]] = raw;
        }
        else if (rest) {
            args[rest] = args[rest] || [];
            args[rest].push(raw);
        }
        else {
            if (kwarg)
                throw new Error("Cannot specify an arg after a kwarg");
            else if (defaultIx)
                throw new Error("Too many args, expected: " + defaults.length + ", got: " + (defaultIx + 1));
            else
                throw new Error("Cannot specify an arg without default keys specified");
        }
    }
    return args;
}
exports.parseArguments = parseArguments;
if (utils_1.ENV === "browser")
    window["parser"] = exports;
function instrumentQuery(q, instrument) {
    var instrumentation = instrument;
    if (!instrument || instrument === true)
        instrumentation = function (fn, args) { return console.log("*", fn, ":", args); };
    var keys = [];
    for (var key in q)
        keys.push(key);
    keys.forEach(function (fn) {
        if (!q.constructor.prototype.hasOwnProperty(fn) || typeof q[fn] !== "function")
            return;
        var old = q[fn];
        q[fn] = function () {
            instrumentation(fn, arguments);
            return old.apply(this, arguments);
        };
    });
    return q;
}
exports.instrumentQuery = instrumentQuery;
function asDiff(ixer, artifacts) {
    var views = artifacts.views;
    var diff = ixer.diff();
    for (var id in views)
        diff.merge(views[id].changeset(app_1.eve));
    return diff;
}
exports.asDiff = asDiff;
function applyAsDiffs(artifacts) {
    var views = artifacts.views;
    for (var id in views)
        app_1.eve.applyDiff(views[id].changeset(app_1.eve));
    console.log("Applied diffs for:");
    for (var id in views)
        console.log("  * ", views[id] instanceof runtime.Query ? "Query" : "Union", views[id].name);
    return artifacts;
}
exports.applyAsDiffs = applyAsDiffs;
function logArtifacts(artifacts) {
    for (var view in artifacts.views)
        console.log(view, "\n", app_1.eve.find(view));
}
exports.logArtifacts = logArtifacts;
var _a, _b;

},{"./app":2,"./runtime":8,"./utils":12}],6:[function(require,module,exports){
var __extends = (this && this.__extends) || function (d, b) {
    for (var p in b) if (b.hasOwnProperty(p)) d[p] = b[p];
    function __() { this.constructor = d; }
    d.prototype = b === null ? Object.create(b) : (__.prototype = b.prototype, new __());
};
var app_1 = require("./app");
window["eve"] = app_1.eve;
// ---------------------------------------------------------
// Token types
// ---------------------------------------------------------
(function (TokenTypes) {
    TokenTypes[TokenTypes["ENTITY"] = 0] = "ENTITY";
    TokenTypes[TokenTypes["COLLECTION"] = 1] = "COLLECTION";
    TokenTypes[TokenTypes["ATTRIBUTE"] = 2] = "ATTRIBUTE";
    TokenTypes[TokenTypes["MODIFIER"] = 3] = "MODIFIER";
    TokenTypes[TokenTypes["OPERATION"] = 4] = "OPERATION";
    TokenTypes[TokenTypes["PATTERN"] = 5] = "PATTERN";
    TokenTypes[TokenTypes["VALUE"] = 6] = "VALUE";
    TokenTypes[TokenTypes["TEXT"] = 7] = "TEXT";
})(exports.TokenTypes || (exports.TokenTypes = {}));
var TokenTypes = exports.TokenTypes;
// ---------------------------------------------------------
// Modifiers
// ---------------------------------------------------------
var modifiers = {
    "and": { and: true },
    "or": { or: true },
    "without": { deselected: true },
    "aren't": { deselected: true },
    "don't": { deselected: true },
    "not": { deselected: true },
    "isn't": { deselected: true },
    "per": { group: true },
    ",": { separator: true },
    "all": { every: true },
    "every": { every: true },
};
// ---------------------------------------------------------
// Patterns
// ---------------------------------------------------------
var patterns = {
    "older": {
        type: "rewrite",
        rewrites: [{ attribute: "age", text: "age >" }],
    },
    "younger": {
        type: "rewrite",
        rewrites: [{ attribute: "age", text: "age <" }],
    },
    "cheaper": {
        type: "rewrite",
        rewrites: [{ attribute: "price", text: "price <" }, { attribute: "cost", text: "cost <" }]
    },
    "greater than": {
        type: "rewrite",
        rewrites: [{ text: ">" }],
    },
    "years old": {
        type: "rewrite",
        rewrites: [{ attribute: "age", text: "age" }],
    },
    "sum": {
        type: "aggregate",
        op: "sum",
        args: ["value"],
    },
    "count": {
        type: "aggregate",
        op: "count",
        args: ["value"],
    },
    "average": {
        type: "aggregate",
        op: "average",
        args: ["value"],
    },
    "top": {
        type: "sort and limit",
        resultingIndirectObject: 1,
        direction: "descending",
        args: ["limit", "attribute"],
    },
    "bottom": {
        type: "sort and limit",
        resultingIndirectObject: 1,
        direction: "ascending",
        args: ["limit", "attribute"],
    },
    "highest": {
        type: "sort and limit",
        limit: 1,
        resultingIndirectObject: 0,
        direction: "descending",
        args: ["attribute"],
    },
    "lowest": {
        type: "sort and limit",
        limit: 1,
        resultingIndirectObject: 0,
        direction: "ascending",
        args: ["attribute"],
    },
    "between": {
        type: "bounds",
        args: ["lower bound", "upper bound", "attribute"],
    },
    "<": {
        type: "filter",
        op: "<",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    ">": {
        type: "filter",
        op: ">",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "<=": {
        type: "filter",
        op: "<=",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    ">=": {
        type: "filter",
        op: ">=",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "=": {
        type: "filter",
        op: "=",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "+": {
        type: "calculate",
        op: "+",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "-": {
        type: "calculate",
        op: "-",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "*": {
        type: "calculate",
        op: "*",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    },
    "/": {
        type: "calculate",
        op: "/",
        infix: true,
        resultingIndirectObject: 0,
        args: ["a", "b"],
    }
};
// ---------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------
function checkForToken(token) {
    var info;
    if (!token)
        return;
    var display = app_1.eve.findOne("display name", { name: token });
    if (display && (info = app_1.eve.findOne("collection", { collection: display.id }))) {
        return { found: display.id, info: info, type: TokenTypes.COLLECTION };
    }
    else if (display && (info = app_1.eve.findOne("entity", { entity: display.id }))) {
        return { found: display.id, info: info, type: TokenTypes.ENTITY };
    }
    else if (info = app_1.eve.findOne("entity eavs", { attribute: token })) {
        return { found: token, info: info, type: TokenTypes.ATTRIBUTE };
    }
    else if (info = modifiers[token]) {
        return { found: token, info: info, type: TokenTypes.MODIFIER };
    }
    else if (info = patterns[token]) {
        return { found: token, info: info, type: TokenTypes.PATTERN };
    }
    else if (token === "true" || token === "false" || token === '"true"' || token === '"false"') {
        return { found: (token === "true" || token === '"true"' ? true : false), type: TokenTypes.VALUE, valueType: "boolean" };
    }
    else if (token.match(/^-?[\d]+$/gm)) {
        return { found: JSON.parse(token), type: TokenTypes.VALUE, valueType: "number" };
    }
    else if (token.match(/^["][^"]*["]$/gm)) {
        return { found: JSON.parse(token), type: TokenTypes.VALUE, valueType: "string" };
    }
    else if (info = /^([\d]+)-([\d]+)$/gm.exec(token)) {
        return { found: token, type: TokenTypes.VALUE, valueType: "range", start: info[1], stop: info[2] };
    }
    return;
}
function getTokens(queryString) {
    // remove all non-word non-space characters
    var cleaned = queryString.replace(/'s/gi, "  ").toLowerCase();
    cleaned = cleaned.replace(/[,.?!]/gi, " , ");
    var words = cleaned.split(" ");
    var front = 0;
    var back = words.length;
    var results = [];
    var pos = 0;
    while (front < words.length) {
        var info = undefined;
        var str = words.slice(front, back).join(" ");
        var orig = str;
        // Check for the word directly
        info = checkForToken(str);
        if (!info) {
            str = pluralize(str, 1);
            // Check the singular version of the word
            info = checkForToken(str);
            if (!info) {
                // Check the plural version of the word
                str = pluralize(str, 2);
                info = checkForToken(str);
            }
        }
        if (info) {
            var found = info.found, type = info.type, valueType = info.valueType, start = info.start, stop = info.stop;
            // Create a new token
            results.push({ found: found, orig: orig, pos: pos, type: type, valueType: valueType, start: start, stop: stop, info: info.info, id: uuid(), children: [] });
            front = back;
            pos += orig.length + 1;
            back = words.length;
        }
        else if (back - 1 > front) {
            back--;
        }
        else {
            if (orig) {
                // Default case: the token is plain text
                results.push({ found: orig, orig: orig, pos: pos, type: TokenTypes.TEXT });
            }
            back = words.length;
            pos += words[front].length + 1;
            front++;
        }
    }
    return results;
}
exports.getTokens = getTokens;
// ---------------------------------------------------------
// Relationships between tokens
// ---------------------------------------------------------
(function (RelationshipTypes) {
    RelationshipTypes[RelationshipTypes["NONE"] = 0] = "NONE";
    RelationshipTypes[RelationshipTypes["ENTITY_ENTITY"] = 1] = "ENTITY_ENTITY";
    RelationshipTypes[RelationshipTypes["ENTITY_ATTRIBUTE"] = 2] = "ENTITY_ATTRIBUTE";
    RelationshipTypes[RelationshipTypes["COLLECTION_COLLECTION"] = 3] = "COLLECTION_COLLECTION";
    RelationshipTypes[RelationshipTypes["COLLECTION_INTERSECTION"] = 4] = "COLLECTION_INTERSECTION";
    RelationshipTypes[RelationshipTypes["COLLECTION_ENTITY"] = 5] = "COLLECTION_ENTITY";
    RelationshipTypes[RelationshipTypes["COLLECTION_ATTRIBUTE"] = 6] = "COLLECTION_ATTRIBUTE";
})(exports.RelationshipTypes || (exports.RelationshipTypes = {}));
var RelationshipTypes = exports.RelationshipTypes;
var tokenRelationships = (_a = {},
    _a[TokenTypes.COLLECTION] = (_b = {},
        _b[TokenTypes.COLLECTION] = findCollectionToCollectionRelationship,
        _b[TokenTypes.ENTITY] = findCollectionToEntRelationship,
        _b[TokenTypes.ATTRIBUTE] = findCollectionToAttrRelationship,
        _b
    ),
    _a[TokenTypes.ENTITY] = (_c = {},
        _c[TokenTypes.ENTITY] = findEntToEntRelationship,
        _c[TokenTypes.ATTRIBUTE] = findEntToAttrRelationship,
        _c
    ),
    _a
);
function determineRelationship(parent, child) {
    if (!tokenRelationships[parent.type] || !tokenRelationships[parent.type][child.type]) {
        return { distance: Infinity, type: RelationshipTypes.NONE };
    }
    else {
        return tokenRelationships[parent.type][child.type](parent.found, child.found);
    }
}
function entityTocollectionsArray(entity) {
    var entities = app_1.eve.find("collection entities", { entity: entity });
    return entities.map(function (a) { return a["collection"]; });
}
function extractFromUnprojected(coll, ix, field, size) {
    var results = [];
    for (var i = 0, len = coll.length; i < len; i += size) {
        results.push(coll[i + ix][field]);
    }
    return results;
}
function findCommonCollections(ents) {
    var intersection = entityTocollectionsArray(ents[0]);
    intersection.sort();
    for (var _i = 0, _a = ents.slice(1); _i < _a.length; _i++) {
        var entId = _a[_i];
        var cur = entityTocollectionsArray(entId);
        cur.sort();
        arrayIntersect(intersection, cur);
    }
    intersection.sort(function (a, b) {
        return app_1.eve.findOne("collection", { collection: b })["count"] - app_1.eve.findOne("collection", { collection: a })["count"];
    });
    return intersection;
}
function findEntToEntRelationship(ent, ent2) {
    return { distance: Infinity, type: RelationshipTypes.ENTITY_ENTITY };
}
// e.g. "salaries in engineering"
// e.g. "chris's age"
function findEntToAttrRelationship(ent, attr) {
    // check if this ent has that attr
    var directAttribute = app_1.eve.findOne("entity eavs", { entity: ent, attribute: attr });
    if (directAttribute) {
        return { distance: 0, type: RelationshipTypes.ENTITY_ATTRIBUTE };
    }
    var relationships = app_1.eve.query("")
        .select("entity links", { entity: ent }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships.unprojected.length) {
        var entities = extractFromUnprojected(relationships.unprojected, 0, "link", 2);
        return { distance: 1, type: RelationshipTypes.ENTITY_ATTRIBUTE, nodes: [findCommonCollections(entities)] };
    }
    var relationships2 = app_1.eve.query("")
        .select("entity links", { entity: ent }, "links")
        .select("entity links", { entity: ["links", "link"] }, "links2")
        .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 0, "link", 3);
        var entities2 = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
        return { distance: 2, type: RelationshipTypes.ENTITY_ATTRIBUTE, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }
    // otherwise we assume it's direct and mark it as unfound.
    return { distance: 0, type: RelationshipTypes.ENTITY_ATTRIBUTE, unfound: true };
}
// e.g. "salaries per department"
function findCollectionToAttrRelationship(coll, attr) {
    var direct = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("entity eavs", { entity: ["collection", "entity"], attribute: attr }, "eav")
        .exec();
    if (direct.unprojected.length) {
        return { distance: 0, type: RelationshipTypes.COLLECTION_ATTRIBUTE, nodes: [] };
    }
    var relationships = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("entity eavs", { entity: ["links", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships.unprojected.length) {
        var entities = extractFromUnprojected(relationships.unprojected, 1, "link", 3);
        return { distance: 1, type: RelationshipTypes.COLLECTION_ATTRIBUTE, nodes: [findCommonCollections(entities)] };
    }
    var relationships2 = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("directionless links", { entity: ["links", "link"] }, "links2")
        .select("entity eavs", { entity: ["links2", "link"], attribute: attr }, "eav")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 1, "link", 4);
        var entities2 = extractFromUnprojected(relationships2.unprojected, 2, "link", 4);
        return { distance: 2, type: RelationshipTypes.COLLECTION_ATTRIBUTE, nodes: [findCommonCollections(entities), findCommonCollections(entities2)] };
    }
}
// e.g. "meetings john was in"
function findCollectionToEntRelationship(coll, ent) {
    if (coll === "collections") {
        if (app_1.eve.findOne("collection entities", { entity: ent })) {
            return { distance: 0, type: "ent->collection" };
        }
    }
    if (app_1.eve.findOne("collection entities", { collection: coll, entity: ent })) {
        return { distance: 0, type: RelationshipTypes.COLLECTION_ENTITY, nodes: [] };
    }
    var relationships = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"], link: ent }, "links")
        .exec();
    if (relationships.unprojected.length) {
        return { distance: 1, type: RelationshipTypes.COLLECTION_ENTITY, nodes: [] };
    }
    // e.g. events with chris granger (events -> meetings -> chris granger)
    var relationships2 = app_1.eve.query("")
        .select("collection entities", { collection: coll }, "collection")
        .select("directionless links", { entity: ["collection", "entity"] }, "links")
        .select("directionless links", { entity: ["links", "link"], link: ent }, "links2")
        .exec();
    if (relationships2.unprojected.length) {
        var entities = extractFromUnprojected(relationships2.unprojected, 1, "link", 3);
        return { distance: 2, type: RelationshipTypes.COLLECTION_ENTITY, nodes: [findCommonCollections(entities)] };
    }
}
// e.g. "authors and papers"
function findCollectionToCollectionRelationship(coll, coll2) {
    // are there things in both sets?
    var intersection = app_1.eve.query(coll + "->" + coll2)
        .select("collection entities", { collection: coll }, "coll1")
        .select("collection entities", { collection: coll2, entity: ["coll1", "entity"] }, "coll2")
        .exec();
    // is there a relationship between things in both sets
    var relationships = app_1.eve.query("relationships between " + coll + " and " + coll2)
        .select("collection entities", { collection: coll }, "coll1")
        .select("directionless links", { entity: ["coll1", "entity"] }, "links")
        .select("collection entities", { collection: coll2, entity: ["links", "link"] }, "coll2")
        .group([["links", "link"]])
        .aggregate("count", {}, "count")
        .project({ type: ["links", "link"], count: ["count", "count"] })
        .exec();
    var maxRel = { count: 0 };
    for (var _i = 0, _a = relationships.results; _i < _a.length; _i++) {
        var result = _a[_i];
        if (result.count > maxRel.count)
            maxRel = result;
    }
    // we divide by two because unprojected results pack rows next to eachother
    // and we have two selects.
    var intersectionSize = intersection.unprojected.length / 2;
    if (maxRel.count > intersectionSize) {
        return { distance: 1, type: RelationshipTypes.COLLECTION_COLLECTION };
    }
    else if (intersectionSize > maxRel.count) {
        return { distance: 0, type: RelationshipTypes.COLLECTION_INTERSECTION };
    }
    else if (maxRel.count === 0 && intersectionSize === 0) {
        return;
    }
    else {
        return { distance: 1, type: RelationshipTypes.COLLECTION_COLLECTION };
    }
}
function tokensToTree(origTokens) {
    var tokens = origTokens;
    var roots = [];
    var operations = [];
    var groups = [];
    // Find the direct object
    // The direct object is the first collection we find, or if there are none,
    // the first entity, or finally the first attribute.
    var directObject;
    for (var _i = 0; _i < tokens.length; _i++) {
        var token = tokens[_i];
        if (token.type === TokenTypes.COLLECTION) {
            directObject = token;
            break;
        }
        else if (token.type === TokenTypes.ENTITY) {
            directObject = token;
        }
        else if (token.type === TokenTypes.ATTRIBUTE && !directObject) {
            directObject = token;
        }
    }
    var tree = { directObject: directObject, roots: roots, operations: operations, groups: groups };
    if (!directObject)
        return tree;
    // the direct object is always the first root
    roots.push(directObject);
    // we need to keep state as we traverse the tokens for modifiers and patterns
    var state = { patternStack: [], currentPattern: null, lastAttribute: null };
    // as we parse the query we may encounter other subjects in the sentence, we
    // need a reference to those previous subjects to see if the current token is
    // related to that or the directObject
    var indirectObject = directObject;
    // Main token loop
    for (var tokenIx = 0, len = tokens.length; tokenIx < len; tokenIx++) {
        var token = tokens[tokenIx];
        var type = token.type, info = token.info, found = token.found;
        // check if the last pass finshed our current pattern.
        if (state.currentPattern && state.currentPattern.args.length) {
            var args = state.currentPattern.args;
            var infoArgs = state.currentPattern.info.args;
            var latestArg = args[args.length - 1];
            var latestArgComplete = latestArg.type === TokenTypes.ATTRIBUTE || latestArg.type === TokenTypes.VALUE;
            while (args.length === infoArgs.length && latestArgComplete) {
                var resultingIndirectObject = state.currentPattern.info.resultingIndirectObject;
                if (resultingIndirectObject !== undefined) {
                    indirectObject = args[resultingIndirectObject];
                }
                else {
                    indirectObject = state.currentPattern;
                }
                state.currentPattern = state.patternStack.pop();
                if (!state.currentPattern)
                    break;
                args = state.currentPattern.args;
                infoArgs = state.currentPattern.info.args;
                args.push(indirectObject);
                latestArg = args[args.length - 1];
                latestArgComplete = latestArg.type === TokenTypes.ATTRIBUTE || latestArg.type === TokenTypes.VALUE;
            }
        }
        // deal with modifiers
        if (type === TokenTypes.MODIFIER) {
            // if this is a deselect modifier, we need to roll forward through the tokens
            // to figure out roughly how far the deselection should go. Also if we run into
            // an "and"" or an "or", we need to deal with that specially.
            if (info.deselected) {
                // we're going to move forward from this token and deselect as we go
                var localTokenIx = tokenIx + 1;
                // get to the first non-text token
                while (localTokenIx < len && tokens[localTokenIx].type === TokenTypes.TEXT) {
                    localTokenIx++;
                }
                // negate until we find a reason to stop
                while (localTokenIx < len) {
                    var localToken = tokens[localTokenIx];
                    if (localToken.type === TokenTypes.TEXT) {
                        break;
                    }
                    localToken.deselected = true;
                    localTokenIx++;
                }
            }
            // if we're dealing with an "or" we have two cases, we're either dealing with a negation
            // or a split. If this is a deselected or, we don't really need to do anything because that
            // means we just do a deselected join. If it's not negated though, we're now dealing with
            // a second query context. e.g. people who are employees or spouses of employees
            if (info.or && !token.deselected) {
                var localTokenIx = tokenIx + 1;
                // get to the first non-text token
                while (localTokenIx < len && tokens[localTokenIx].type === TokenTypes.TEXT) {
                    localTokenIx++;
                }
                // consume until we hit a separator
                while (localTokenIx < len) {
                    var localToken = tokens[localTokenIx];
                    if (localToken.type === TokenTypes.TEXT) {
                        break;
                    }
                    localTokenIx++;
                }
            }
            // a group adds a group for the next collection and checks to see if there's an and
            // or a separator that would indicate multiple groupings
            if (info.group) {
                // we're going to move forward from this token and deselect as we go
                var localTokenIx = tokenIx + 1;
                // get to the first non-text token
                while (localTokenIx < len && tokens[localTokenIx].type === TokenTypes.TEXT) {
                    localTokenIx++;
                }
                // if we've run out of tokens, bail
                if (localTokenIx === len)
                    break;
                // otherwise, the next thing we found is what we're trying to group by
                var localToken = tokens[localTokenIx];
                localToken.grouped = true;
                groups.push(localToken);
                localTokenIx++;
                // now we have to check if we're trying to group by multiple things, e.g.
                // "per department and age" or "per department, team, and age"
                var next = tokens[localTokenIx];
                while (next && next.type === TokenTypes.MODIFIER && (next.info.separator || next.info.and)) {
                    localTokenIx++;
                    next = tokens[localTokenIx];
                    // if we have another modifier directly after (e.g. ", and") loop again
                    // to see if this is valid.
                    if (next && next.type === TokenTypes.MODIFIER) {
                        continue;
                    }
                    next.grouped = true;
                    groups.push(next);
                    localTokenIx++;
                    next = tokens[localTokenIx];
                }
            }
            continue;
        }
        // deal with patterns
        if (type === TokenTypes.PATTERN) {
            if (info.type === "rewrite") {
                var newText = void 0;
                // if we only have one possible rewrite, we can just take it
                if (info.rewrites.length === 1) {
                    newText = info.rewrites[0].text;
                }
                else {
                    // @TODO: we have to go through every possibility and deal with it
                    newText = info.rewrites[0].text;
                }
                // Tokenize the new string.
                var newTokens = getTokens(newText);
                // Splice in the new tokens, adjust the length and make sure we revisit this token.
                len += newTokens.length;
                tokens.splice.apply(tokens, [tokenIx + 1, 0].concat(newTokens));
                // apply any deselects, or's, or and's to this token
                for (var _a = 0; _a < newTokens.length; _a++) {
                    var newToken = newTokens[_a];
                    newToken.deselected = token.deselected;
                    newToken.and = token.and;
                    newToken.or = token.or;
                }
                continue;
            }
            else {
                // otherwise it's an operation of some kind
                operations.push(token);
                // keep track of any other patterns we're trying to fill right now
                if (state.currentPattern) {
                    state.patternStack.push(state.currentPattern);
                }
                state.currentPattern = token;
                state.currentPattern.args = [];
            }
            if (info.infix) {
                state.currentPattern.args.push(indirectObject);
            }
            continue;
        }
        // deal with values
        if (type === TokenTypes.VALUE) {
            // Deal with a range value. It's really a pattern
            if (token.valueType === "range") {
                token.found = "between";
                token.info = patterns["between"];
                token.args = [];
                var start = { id: uuid(), found: token.start, orig: token.start, pos: token.pos, type: TokenTypes.VALUE, info: parseFloat(token.start), valueType: "number" };
                var stop = { id: uuid(), found: token.stop, orig: token.stop, pos: token.pos, type: TokenTypes.VALUE, info: parseFloat(token.stop), valueType: "number" };
                token.args.push(start);
                token.args.push(stop);
                operations.push(token);
                state.patternStack.push(token);
                if (state.currentPattern === null) {
                    state.currentPattern = state.patternStack.pop();
                }
                continue;
            }
            // if we still have a currentPattern to fill
            if (state.currentPattern && state.currentPattern.args.length < state.currentPattern.info.args.length) {
                state.currentPattern.args.push(token);
            }
            continue;
        }
        // We don't do anything with text nodes at this point
        if (type === TokenTypes.TEXT)
            continue;
        // once modifiers and patterns have been applied, we don't need to worry
        // about the directObject as it's already been assigned to the first root.
        if (directObject === token) {
            indirectObject = directObject;
            continue;
        }
        if (directObject === indirectObject) {
            directObject.children.push(token);
            token.relationship = determineRelationship(directObject, token);
            token.parent = directObject;
            indirectObject = token;
        }
        else {
            var potentialParent = indirectObject;
            // if our indirect object is an attribute and we encounter another one, we want to check
            // the parent of this node for a match
            if (indirectObject.type === TokenTypes.ATTRIBUTE && token.type === TokenTypes.ATTRIBUTE) {
                potentialParent = indirectObject.parent;
            }
            // if the indirect object is an attribute, anything other than another attribute will create
            // a new root
            if (indirectObject.type === TokenTypes.ATTRIBUTE && token.type !== TokenTypes.ATTRIBUTE) {
                var rootRel = determineRelationship(directObject, token);
                if (!rootRel || (rootRel.distance === 0 && token.type === TokenTypes.ENTITY)) {
                    indirectObject = token;
                    roots.push(indirectObject);
                }
                else {
                    directObject.children.push(token);
                    token.relationship = rootRel;
                    token.parent = directObject;
                }
            }
            else if (potentialParent.type === TokenTypes.ENTITY && token.type !== TokenTypes.ATTRIBUTE) {
                directObject.children.push(token);
                token.relationship = determineRelationship(directObject, token);
                token.parent = directObject;
                indirectObject = token;
            }
            else {
                var cursorRel = determineRelationship(potentialParent, token);
                var rootRel = determineRelationship(directObject, token);
                // if this token is an entity and either the directObject or indirectObject has a direct relationship
                // we don't really want to use that as it's most likely meant to filter a set down
                // instead of reduce the set to exactly one member.
                if (token.type === TokenTypes.ENTITY) {
                    if (cursorRel && cursorRel.distance === 0)
                        cursorRel = null;
                    if (rootRel && rootRel.distance === 0)
                        rootRel = null;
                }
                if (!cursorRel) {
                    directObject.children.push(token);
                    token.relationship = rootRel;
                    token.parent = directObject;
                }
                else if (!rootRel) {
                    potentialParent.children.push(token);
                    token.relationship = cursorRel;
                    token.parent = potentialParent;
                }
                else if (cursorRel.distance <= rootRel.distance) {
                    potentialParent.children.push(token);
                    token.relationship = cursorRel;
                    token.parent = potentialParent;
                }
                else {
                    // @TODO: maybe if there's a cursorRel we should just always ignore the rootRel even if it
                    // is a "better" relationship. Sentence structure-wise it seems pretty likely that attributes
                    // following an entity are related to that entity and not something else.
                    directObject.children.push(token);
                    token.relationship = rootRel;
                    token.parent = directObject;
                }
                indirectObject = token;
            }
        }
        // if we are still looking to fill in a pattern
        if (state.currentPattern) {
            var args = state.currentPattern.args;
            var infoArgs = state.currentPattern.info.args;
            var latestArg = args[args.length - 1];
            var latestArgComplete = !latestArg || latestArg.type === TokenTypes.ATTRIBUTE || latestArg.type === TokenTypes.VALUE;
            var firstArg = args[0];
            if (!latestArgComplete && indirectObject.type === TokenTypes.ATTRIBUTE) {
                args.pop();
                args.push(indirectObject);
            }
            else if (latestArgComplete && args.length < infoArgs.length) {
                args.push(indirectObject);
                latestArg = indirectObject;
            }
        }
    }
    // End main token loop
    // if we've run out of tokens and are still looking to fill in a pattern,
    // we might need to carry the attribute through.
    if (state.currentPattern && state.currentPattern.args.length <= state.currentPattern.info.args.length) {
        var args = state.currentPattern.args;
        var infoArgs = state.currentPattern.info.args;
        var latestArg = args[args.length - 1];
        if (!latestArg)
            return tree;
        var latestArgComplete = latestArg.type === TokenTypes.ATTRIBUTE || latestArg.type === TokenTypes.VALUE;
        var firstArg = args[0];
        // e.g. people older than chris granger => people age > chris granger age
        if (!latestArgComplete && firstArg && firstArg.type === TokenTypes.ATTRIBUTE) {
            var newArg = { type: firstArg.type, found: firstArg.found, orig: firstArg.orig, info: firstArg.info, id: uuid(), children: [] };
            var cursorRel = determineRelationship(latestArg, newArg);
            newArg.relationship = cursorRel;
            newArg.parent = latestArg;
            latestArg.children.push(newArg);
            args.pop();
            args.push(newArg);
        }
        else if (state.currentPattern.found === "between") {
            // Backtrack from the pattern start until we find an attribute
            var patternStart = tokens.lastIndexOf(state.currentPattern);
            var arg = null;
            for (var ix = patternStart; ix > 0; ix--) {
                if (tokens[ix].type === TokenTypes.ATTRIBUTE) {
                    arg = tokens[ix];
                    break;
                }
            }
            // If we found an attribute, now add it to the arglist for the pattern
            if (arg != null) {
                state.currentPattern.args.push(arg);
            }
        }
    }
    return tree;
}
// ---------------------------------------------------------
// Query plans
// ---------------------------------------------------------
(function (StepType) {
    StepType[StepType["FIND"] = 0] = "FIND";
    StepType[StepType["GATHER"] = 1] = "GATHER";
    StepType[StepType["LOOKUP"] = 2] = "LOOKUP";
    StepType[StepType["FILTERBYENTITY"] = 3] = "FILTERBYENTITY";
    StepType[StepType["INTERSECT"] = 4] = "INTERSECT";
    StepType[StepType["CALCULATE"] = 5] = "CALCULATE";
    StepType[StepType["AGGREGATE"] = 6] = "AGGREGATE";
    StepType[StepType["FILTER"] = 7] = "FILTER";
    StepType[StepType["SORT"] = 8] = "SORT";
    StepType[StepType["LIMIT"] = 9] = "LIMIT";
    StepType[StepType["GROUP"] = 10] = "GROUP";
})(exports.StepType || (exports.StepType = {}));
var StepType = exports.StepType;
function queryToPlan(query) {
    var tokens = getTokens(query);
    var tree = tokensToTree(tokens);
    var plan = treeToPlan(tree);
    return { tokens: tokens, tree: tree, plan: plan };
}
exports.queryToPlan = queryToPlan;
var Plan = (function (_super) {
    __extends(Plan, _super);
    function Plan() {
        _super.apply(this, arguments);
    }
    return Plan;
})(Array);
exports.Plan = Plan;
(function (Validated) {
    Validated[Validated["INVALID"] = 0] = "INVALID";
    Validated[Validated["VALID"] = 1] = "VALID";
    Validated[Validated["UNVALIDATED"] = 2] = "UNVALIDATED";
})(exports.Validated || (exports.Validated = {}));
var Validated = exports.Validated;
function ignoreHiddenCollections(colls) {
    for (var _i = 0; _i < colls.length; _i++) {
        var coll = colls[_i];
        if (coll !== "generic related to") {
            return coll;
        }
    }
}
function nodeToPlanSteps(node, parent, parentPlan) {
    // TODO: figure out what to do with operations
    var id = node.id || uuid();
    var deselected = node.deselected;
    var rel = node.relationship;
    var plan = [];
    var curParent = parentPlan;
    if (parent && rel) {
        switch (rel.type) {
            case RelationshipTypes.COLLECTION_ATTRIBUTE:
                for (var _i = 0, _a = rel.nodes; _i < _a.length; _i++) {
                    var node_1 = _a[_i];
                    var coll = ignoreHiddenCollections(node_1);
                    var item = { type: StepType.GATHER, relatedTo: curParent, subject: coll, id: uuid() };
                    plan.push(item);
                    curParent = item;
                }
                plan.push({ type: StepType.LOOKUP, relatedTo: curParent, subject: node.found, id: id, deselected: deselected });
                return plan;
                break;
            case RelationshipTypes.COLLECTION_ENTITY:
                for (var _b = 0, _c = rel.nodes; _b < _c.length; _b++) {
                    var node_2 = _c[_b];
                    var coll = ignoreHiddenCollections(node_2);
                    var item = { type: StepType.GATHER, relatedTo: curParent, subject: coll, id: uuid() };
                    plan.push(item);
                    curParent = item;
                }
                plan.push({ type: StepType.FILTERBYENTITY, relatedTo: curParent, subject: node.found, id: id, deselected: deselected });
                return plan;
                break;
            case RelationshipTypes.COLLECTION_COLLECTION:
                return [{ type: StepType.GATHER, relatedTo: parentPlan, subject: node.found, id: id, deselected: deselected }];
                break;
            case RelationshipTypes.COLLECTION_INTERSECTION:
                return [{ type: StepType.INTERSECT, relatedTo: parentPlan, subject: node.found, id: id, deselected: deselected }];
                break;
            case RelationshipTypes.ENTITY_ATTRIBUTE:
                if (rel.distance === 0) {
                    return [{ type: StepType.LOOKUP, relatedTo: parentPlan, subject: node.found, id: id, deselected: deselected }];
                }
                else {
                    var plan_1 = [];
                    var curParent_1 = parentPlan;
                    for (var _d = 0, _e = rel.nodes; _d < _e.length; _d++) {
                        var node_3 = _e[_d];
                        var coll = ignoreHiddenCollections(node_3);
                        var item = { type: StepType.GATHER, relatedTo: curParent_1, subject: coll, id: uuid() };
                        plan_1.push(item);
                        curParent_1 = item;
                    }
                    plan_1.push({ type: StepType.LOOKUP, relatedTo: curParent_1, subject: node.found, id: id, deselected: deselected });
                    return plan_1;
                }
                break;
        }
    }
    else {
        if (node.type === TokenTypes.COLLECTION) {
            return [{ type: StepType.GATHER, subject: node.found, id: id, deselected: deselected }];
        }
        else if (node.type === TokenTypes.ENTITY) {
            return [{ type: StepType.FIND, subject: node.found, id: id, deselected: deselected }];
        }
        else if (node.type === TokenTypes.ATTRIBUTE) {
            return [{ type: StepType.LOOKUP, subject: node.found, id: id, deselected: deselected }];
        }
        return [];
    }
}
function nodeToPlan(tree, parent, parentPlan) {
    if (parent === void 0) { parent = null; }
    if (parentPlan === void 0) { parentPlan = null; }
    if (!tree)
        return [];
    var plan = [];
    // process you, then your children
    plan.push.apply(plan, nodeToPlanSteps(tree, parent, parentPlan));
    var neueParentPlan = plan[plan.length - 1];
    for (var _i = 0, _a = tree.children; _i < _a.length; _i++) {
        var child = _a[_i];
        plan.push.apply(plan, nodeToPlan(child, tree, neueParentPlan));
    }
    return plan;
}
/*enum PatternTypes {
  COLLECTION,
  ENTITY,
  ATTRIBUTE,
  VALUE,
  GROUP,
  AGGREGATE,
  SORTLIMIT,
  FILTER,
  REWRITE,
}*/
function groupsToPlan(nodes) {
    if (!nodes.length)
        return [];
    var groups = [];
    for (var _i = 0; _i < nodes.length; _i++) {
        var node = nodes[_i];
        if (node.type === "collection") {
            groups.push([node.id, "entity"]);
        }
        else if (node.type === "attribute") {
            groups.push([node.id, "value"]);
        }
        else {
            throw new Error("Invalid node to group on: " + JSON.stringify(nodes));
        }
    }
    return [{ type: StepType.GROUP, id: uuid(), groups: groups, groupNodes: nodes }];
}
function opToPlan(op, groups) {
    var info = op.info;
    var args = {};
    if (info.args) {
        var ix = 0;
        for (var _i = 0, _a = info.args; _i < _a.length; _i++) {
            var arg = _a[_i];
            var argValue = op.args[ix];
            if (argValue === undefined)
                continue;
            if (argValue.type === TokenTypes.VALUE) {
                args[arg] = argValue.found;
            }
            else if (argValue.type === TokenTypes.ATTRIBUTE) {
                args[arg] = [argValue.id, "value"];
            }
            else {
                console.error("Invalid operation argument: " + argValue.orig + " for " + op.found);
            }
            ix++;
        }
    }
    if (info.type === "aggregate") {
        return [{ type: StepType.AGGREGATE, subject: info.op, args: args, id: uuid(), argArray: op.args }];
    }
    else if (info.type === "sort and limit") {
        var sortLimitArgs = op.args.map(function (arg) { return arg.found; });
        var sortField = { parentId: op.args[1].id, parent: op.args[1].parent.found, subject: op.args[1].found };
        var subject = "results";
        // If groups are formed, check if we are sorting on one of them
        for (var _b = 0; _b < groups.length; _b++) {
            var group = groups[_b];
            if (group.found === sortField.parent) {
                subject = "per group";
                break;
            }
        }
        var sortStep = { type: StepType.SORT, subject: subject, direction: info.direction, field: sortField, id: uuid() };
        var limitStep = { type: StepType.LIMIT, subject: subject, value: sortLimitArgs[0], id: uuid() };
        return [sortStep, limitStep];
    }
    else if (info.type === "bounds") {
        var lowerBounds = { type: StepType.FILTER, subject: ">", id: uuid(), argArray: [op.args[2], op.args[0]] };
        var upperBounds = { type: StepType.FILTER, subject: "<", id: uuid(), argArray: [op.args[2], op.args[1]] };
        return [lowerBounds, upperBounds];
    }
    else if (info.type === "filter") {
        return [{ type: StepType.FILTER, subject: info.op, args: args, id: uuid(), argArray: op.args }];
    }
    else {
        return [{ type: StepType.CALCULATE, subject: info.op, args: args, id: uuid(), argArray: op.args }];
    }
}
// Since intermediate plan steps can end up duplicated, we need to walk the plan to find
// nodes that are exactly the same and only do them once. E.g. salaries per department and age
// will bring in two employee gathers.
function dedupePlan(plan) {
    var dupes = {};
    // for every node in the plan backwards
    for (var planIx = plan.length - 1; planIx > -1; planIx--) {
        var step = plan[planIx];
        // check all preceding nodes for a node that is equivalent
        for (var dupeIx = planIx - 1; dupeIx > -1; dupeIx--) {
            var dupe = plan[dupeIx];
            // equivalency requires the same type, subject, deselect, and parent
            if (step.type === dupe.type && step.subject === dupe.subject && step.deselected === dupe.deselected && step.relatedTo === dupe.relatedTo) {
                // store the dupe and what node will replace it
                dupes[step.id] = dupe.id;
            }
        }
    }
    return plan.filter(function (step) {
        // remove anything we found to be a dupe
        if (dupes[step.id])
            return false;
        // if this step references a dupe, relate it to the new node
        if (dupes[step.relatedTo]) {
            step.relatedTo = dupes[step.relatedTo];
        }
        return true;
    });
}
function treeToPlan(tree) {
    var steps = [];
    for (var _i = 0, _a = tree.roots; _i < _a.length; _i++) {
        var root = _a[_i];
        steps = steps.concat(nodeToPlan(root));
    }
    steps = dedupePlan(steps);
    for (var _b = 0, _c = tree.groups; _b < _c.length; _b++) {
        var group = _c[_b];
        var node = void 0;
        for (var _d = 0; _d < steps.length; _d++) {
            var step = steps[_d];
            if (step.id === group.id) {
                node = step;
                break;
            }
        }
        steps.push({ id: uuid(), type: StepType.GROUP, subject: group.found, subjectNode: node });
    }
    for (var _e = 0, _f = tree.operations; _e < _f.length; _e++) {
        var op = _f[_e];
        steps = steps.concat(opToPlan(op, tree.groups));
    }
    // Create a plan type for return
    var plan = new Plan();
    plan.valid = Validated.INVALID;
    for (var _g = 0; _g < steps.length; _g++) {
        var step = steps[_g];
        plan.push(step);
    }
    return plan;
}
// ---------------------------------------------------------
// Plan to query
// ---------------------------------------------------------
function safeProjectionName(name, projection) {
    if (!projection[name]) {
        return name;
    }
    var ix = 2;
    while (projection[name]) {
        name = name + " " + ix;
        ix++;
    }
    return name;
}
function planToExecutable(plan) {
    var projection = {};
    var query = app_1.eve.query();
    for (var _i = 0; _i < plan.length; _i++) {
        var step = plan[_i];
        switch (step.type) {
            case StepType.FIND:
                // find is a no-op
                step.size = 0;
                break;
            case StepType.GATHER:
                var join = {};
                if (step.subject) {
                    join.collection = step.subject;
                }
                var related = step.relatedTo;
                if (related) {
                    if (related.type === StepType.FIND) {
                        step.size = 2;
                        var linkId_1 = step.id + " | link";
                        query.select("directionless links", { entity: related.subject }, linkId_1);
                        join.entity = [linkId_1, "link"];
                        query.select("collection entities", join, step.id);
                    }
                    else {
                        step.size = 2;
                        var linkId_2 = step.id + " | link";
                        query.select("directionless links", { entity: [related.id, "entity"] }, linkId_2);
                        join.entity = [linkId_2, "link"];
                        query.select("collection entities", join, step.id);
                    }
                }
                else {
                    step.size = 1;
                    query.select("collection entities", join, step.id);
                }
                step.name = safeProjectionName(step.subject, projection);
                projection[step.name] = [step.id, "entity"];
                break;
            case StepType.LOOKUP:
                var join = { attribute: step.subject };
                var related = step.relatedTo;
                if (related) {
                    if (related.type === StepType.FIND) {
                        join.entity = related.subject;
                    }
                    else {
                        join.entity = [related.id, "entity"];
                    }
                }
                if (step.deselected) {
                    step.size = 0;
                    query.deselect("entity eavs", join, step.id);
                }
                else {
                    step.size = 1;
                    query.select("entity eavs", join, step.id);
                    step.name = safeProjectionName(step.subject, projection);
                    projection[step.name] = [step.id, "value"];
                }
                break;
            case StepType.INTERSECT:
                var related = step.relatedTo;
                if (step.deselected) {
                    step.size = 0;
                    query.deselect("collection entities", { collection: step.subject, entity: [related.id, "entity"] });
                }
                else {
                    step.size = 1;
                    query.select("collection entities", { collection: step.subject, entity: [related.id, "entity"] }, step.id);
                }
                break;
            case StepType.FILTERBYENTITY:
                var related = step.relatedTo;
                var linkId = step.id + " | link";
                if (step.deselected) {
                    step.size = 0;
                    query.deselect("directionless links", { entity: [related.id, "entity"], link: step.subject });
                }
                else {
                    step.size = 1;
                    query.select("directionless links", { entity: [related.id, "entity"], link: step.subject }, step.id);
                }
                break;
            case StepType.FILTER:
                step.size = 0;
                query.calculate(step.subject, step.args, step.id);
                break;
            case StepType.CALCULATE:
                step.size = 1;
                query.calculate(step.subject, step.args, step.id);
                step.name = safeProjectionName(step.subject, projection);
                projection[step.name] = [step.id, "result"];
                break;
            case StepType.AGGREGATE:
                step.size = 1;
                query.aggregate(step.subject, step.args, step.id);
                step.name = safeProjectionName(step.subject, projection);
                projection[step.name] = [step.id, step.subject];
                break;
            case StepType.GROUP:
                step.size = 0;
                var field = "entity";
                if (step.subjectNode.type === StepType.LOOKUP) {
                    field = "value";
                }
                step.name = step.subjectNode.name;
                query.group([step.subjectNode.id, field]);
                break;
            case StepType.SORT:
                step.size = 0;
                query.sort([step.field.parentId, "value", step.direction]);
                break;
            case StepType.LIMIT:
                step.size = 0;
                query.limit(step.limit);
                break;
        }
    }
    query.project(projection);
    return query;
}
exports.planToExecutable = planToExecutable;
function queryToExecutable(query) {
    var planInfo = queryToPlan(query);
    var executable = planToExecutable(planInfo.plan);
    planInfo.executable = executable;
    planInfo.queryString = query;
    return planInfo;
}
exports.queryToExecutable = queryToExecutable;
// ---------------------------------------------------------
// Utils
// ---------------------------------------------------------
function arrayIntersect(a, b) {
    var ai = 0;
    var bi = 0;
    var result = [];
    while (ai < a.length && bi < b.length) {
        if (a[ai] < b[bi])
            ai++;
        else if (a[ai] > b[bi])
            bi++;
        else {
            result.push(a[ai]);
            ai++;
            bi++;
        }
    }
    return result;
}
window["queryParser"] = exports;
var _a, _b, _c;

},{"./app":2}],7:[function(require,module,exports){
function replaceAll(str, find, replace) {
    var regex = new RegExp(find.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g');
    return str.replace(regex, replace);
}
function wrapWithMarkdown(cm, wrapping) {
    cm.operation(function () {
        var from = cm.getCursor("from");
        // if there's something selected wrap it
        if (cm.somethingSelected()) {
            var selected = cm.getSelection();
            var cleaned = replaceAll(selected, wrapping, "");
            if (selected.substring(0, wrapping.length) === wrapping
                && selected.substring(selected.length - wrapping.length) === wrapping) {
                cm.replaceRange(cleaned, from, cm.getCursor("to"));
                cm.setSelection(from, cm.getCursor("from"));
            }
            else {
                cm.replaceRange("" + wrapping + cleaned + wrapping, from, cm.getCursor("to"));
                cm.setSelection(from, cm.getCursor("from"));
            }
        }
        else {
            cm.replaceRange("" + wrapping + wrapping, from);
            var newLocation = { line: from.line, ch: from.ch + wrapping.length };
            cm.setCursor(newLocation);
        }
    });
}
var RichTextEditor = (function () {
    function RichTextEditor(node, getEmbed, getInline, removeInline) {
        this.marks = [];
        this.meta = {};
        this.getEmbed = getEmbed;
        this.getInline = getInline;
        this.removeInline = removeInline;
        var cm = this.cmInstance = new CodeMirror(node, {
            lineWrapping: true,
            autoCloseBrackets: true,
            viewportMargin: Infinity,
            extraKeys: {
                "Cmd-B": function (cm) {
                    wrapWithMarkdown(cm, "**");
                },
                "Cmd-I": function (cm) {
                    wrapWithMarkdown(cm, "_");
                },
            }
        });
        var self = this;
        cm.on("changes", function (cm, changes) {
            self.onChanges(cm, changes);
            if (self.onUpdate) {
                self.onUpdate(self.meta, cm.getValue());
            }
        });
        cm.on("cursorActivity", function (cm) { self.onCursorActivity(cm); });
        cm.on("mousedown", function (cm, e) { self.onMouseDown(cm, e); });
    }
    RichTextEditor.prototype.onChanges = function (cm, changes) {
        var self = this;
        for (var _i = 0; _i < changes.length; _i++) {
            var change = changes[_i];
            var removed = change.removed.join("\n");
            var matches = removed.match(/({[^]*?})/gm);
            if (!matches)
                continue;
            for (var _a = 0; _a < matches.length; _a++) {
                var match = matches[_a];
                this.removeInline(this.meta, match);
            }
        }
        cm.operation(function () {
            var content = cm.getValue();
            var parts = content.split(/({[^]*?})/gm);
            var ix = 0;
            for (var _i = 0, _a = self.marks; _i < _a.length; _i++) {
                var mark = _a[_i];
                mark.clear();
            }
            self.marks = [];
            var cursorIx = cm.indexFromPos(cm.getCursor("from"));
            for (var _b = 0; _b < parts.length; _b++) {
                var part = parts[_b];
                if (part[0] === "{") {
                    var mark = self.markEmbeddedQuery(cm, part, ix);
                    if (mark)
                        self.marks.push(mark);
                }
                ix += part.length;
            }
        });
    };
    RichTextEditor.prototype.onCursorActivity = function (cm) {
        if (!cm.somethingSelected()) {
            var cursor = cm.getCursor("from");
            var marks = cm.findMarksAt(cursor);
            for (var _i = 0; _i < marks.length; _i++) {
                var mark = marks[_i];
                if (mark.needsReplacement) {
                    var _a = mark.find(), from = _a.from, to = _a.to;
                    var ix = cm.indexFromPos(from);
                    var text = cm.getRange(from, to);
                    mark.clear();
                    var newMark = this.markEmbeddedQuery(cm, text, ix);
                    if (newMark)
                        this.marks.push(newMark);
                }
            }
        }
        clearTimeout(this.timeout);
        this.timeout = setTimeout(function () {
            if (cm.somethingSelected()) {
            }
        }, 1000);
    };
    RichTextEditor.prototype.onMouseDown = function (cm, e) {
        var cursor = cm.coordsChar({ left: e.clientX, top: e.clientY });
        var pos = cm.indexFromPos(cursor);
        var marks = cm.findMarksAt(cursor);
        for (var _i = 0, _a = this.marks; _i < _a.length; _i++) {
            var mark = _a[_i];
            if (mark.info && mark.info.to) {
            }
        }
    };
    RichTextEditor.prototype.markEmbeddedQuery = function (cm, query, ix) {
        var cursorIx = cm.indexFromPos(cm.getCursor("from"));
        var mark;
        var start = cm.posFromIndex(ix);
        var stop = cm.posFromIndex(ix + query.length);
        // as long as our cursor isn't in this span
        if (query !== "{}" && (cursorIx <= ix || cursorIx >= ix + query.length)) {
            // check if this is a query that's defining an inline attribute
            // e.g. {age: 30}
            var adjusted = this.getInline(this.meta, query);
            if (adjusted !== query) {
                cm.replaceRange(adjusted, start, stop);
            }
            else {
                mark = cm.markText(start, stop, { replacedWith: this.getEmbed(this.meta, query.substring(1, query.length - 1)) });
            }
        }
        else {
            mark = cm.markText(start, stop, { className: "embed-code" });
            mark.needsReplacement = true;
        }
        return mark;
    };
    return RichTextEditor;
})();
exports.RichTextEditor = RichTextEditor;
function createEditor(getEmbed, getInline, removeInline) {
    return function wrapRichTextEditor(node, elem) {
        var editor = node.editor;
        var cm;
        if (!editor) {
            editor = node.editor = new RichTextEditor(node, getEmbed, getInline, removeInline);
            cm = node.editor.cmInstance;
            cm.focus();
        }
        else {
            cm = node.editor.cmInstance;
        }
        editor.onUpdate = elem.change;
        editor.meta = elem.meta || editor.meta;
        if (cm.getValue() !== elem.value) {
            cm.setValue(elem.value || "");
            cm.clearHistory();
        }
        cm.refresh();
    };
}
exports.createEditor = createEditor;

},{}],8:[function(require,module,exports){
var utils_1 = require("./utils");
var runtime = exports;
exports.MAX_NUMBER = 9007199254740991;
exports.INCREMENTAL = false;
function objectsIdentical(a, b) {
    var aKeys = Object.keys(a);
    for (var _i = 0; _i < aKeys.length; _i++) {
        var key = aKeys[_i];
        //TODO: handle non-scalar values
        if (a[key] !== b[key])
            return false;
    }
    return true;
}
function indexOfFact(haystack, needle) {
    var ix = 0;
    for (var _i = 0; _i < haystack.length; _i++) {
        var fact = haystack[_i];
        if (fact.__id === needle.__id) {
            return ix;
        }
        ix++;
    }
    return -1;
}
function removeFact(haystack, needle) {
    var ix = indexOfFact(haystack, needle);
    if (ix > -1)
        haystack.splice(ix, 1);
    return haystack;
}
exports.removeFact = removeFact;
function diffAddsAndRemoves(adds, removes) {
    var localHash = {};
    var hashToFact = {};
    var hashes = [];
    for (var _i = 0; _i < adds.length; _i++) {
        var add = adds[_i];
        var hash = add.__id;
        if (localHash[hash] === undefined) {
            localHash[hash] = 1;
            hashToFact[hash] = add;
            hashes.push(hash);
        }
        else {
            localHash[hash]++;
        }
        add.__id = hash;
    }
    for (var _a = 0; _a < removes.length; _a++) {
        var remove = removes[_a];
        var hash = remove.__id;
        if (localHash[hash] === undefined) {
            localHash[hash] = -1;
            hashToFact[hash] = remove;
            hashes.push(hash);
        }
        else {
            localHash[hash]--;
        }
        remove.__id = hash;
    }
    var realAdds = [];
    var realRemoves = [];
    for (var _b = 0; _b < hashes.length; _b++) {
        var hash = hashes[_b];
        var count = localHash[hash];
        if (count > 0) {
            var fact = hashToFact[hash];
            realAdds.push(fact);
        }
        else if (count < 0) {
            var fact = hashToFact[hash];
            realRemoves.push(fact);
        }
    }
    return { adds: realAdds, removes: realRemoves };
}
function generateEqualityFn(keys) {
    return new Function("a", "b", "return " + keys.map(function (key, ix) {
        if (key.constructor === Array) {
            return "a['" + key[0] + "']['" + key[1] + "'] === b['" + key[0] + "']['" + key[1] + "']";
        }
        else {
            return "a[\"" + key + "\"] === b[\"" + key + "\"]";
        }
    }).join(" && ") + ";");
}
function generateStringFn(keys) {
    var keyStrings = [];
    for (var _i = 0; _i < keys.length; _i++) {
        var key = keys[_i];
        if (key.constructor === Array) {
            keyStrings.push("a['" + key[0] + "']['" + key[1] + "']");
        }
        else {
            keyStrings.push("a['" + key + "']");
        }
    }
    var final = keyStrings.join(' + "|" + ');
    return new Function("a", "return " + final + ";");
}
function generateUnprojectedSorterCode(unprojectedSize, sorts) {
    var conditions = [];
    var path = [];
    var distance = unprojectedSize;
    for (var _i = 0; _i < sorts.length; _i++) {
        var sort = sorts[_i];
        var condition = "";
        for (var _a = 0; _a < path.length; _a++) {
            var prev = path[_a];
            var table_1 = prev[0], key_1 = prev[1];
            condition += "unprojected[j-" + (distance - table_1) + "]['" + key_1 + "'] === item" + table_1 + "['" + key_1 + "'] && ";
        }
        var table = sort[0], key = sort[1], dir = sort[2];
        var op = ">";
        if (dir === "descending") {
            op = "<";
        }
        condition += "unprojected[j-" + (distance - table) + "]['" + key + "'] " + op + " item" + table + "['" + key + "']";
        conditions.push(condition);
        path.push(sort);
    }
    var items = [];
    var repositioned = [];
    var itemAssignments = [];
    for (var ix = 0; ix < distance; ix++) {
        items.push("item" + ix + " = unprojected[j+" + ix + "]");
        repositioned.push("unprojected[j+" + ix + "] = unprojected[j - " + (distance - ix) + "]");
        itemAssignments.push(("unprojected[j+" + ix + "] = item" + ix));
    }
    return "for (var i = 0, len = unprojected.length; i < len; i += " + distance + ") {\n      var j = i, " + items.join(", ") + ";\n      for(; j > " + (distance - 1) + " && (" + conditions.join(" || ") + "); j -= " + distance + ") {\n        " + repositioned.join(";\n") + "\n      }\n      " + itemAssignments.join(";\n") + "\n  }";
}
function generateCollector(keys) {
    var code = "var runtime = this;\n";
    var ix = 0;
    var checks = "";
    var removes = "var cur = index";
    for (var _i = 0; _i < keys.length; _i++) {
        var key = keys[_i];
        if (key.constructor === Array) {
            removes += "[remove['" + key[0] + "']['" + key[1] + "']]";
        }
        else {
            removes += "[remove['" + key + "']]";
        }
    }
    removes += ";\nruntime.removeFact(cur, remove);";
    for (var _a = 0; _a < keys.length; _a++) {
        var key = keys[_a];
        ix++;
        if (key.constructor === Array) {
            checks += "value = add['" + key[0] + "']['" + key[1] + "']\n";
        }
        else {
            checks += "value = add['" + key + "']\n";
        }
        var path = "cursor[value]";
        checks += "if(!" + path + ") " + path + " = ";
        if (ix === keys.length) {
            checks += "[]\n";
        }
        else {
            checks += "{}\n";
        }
        checks += "cursor = " + path + "\n";
    }
    code += "\nfor(var ix = 0, len = removes.length; ix < len; ix++) {\nvar remove = removes[ix];\n" + removes + "\n}\nfor(var ix = 0, len = adds.length; ix < len; ix++) {\nvar add = adds[ix];\nvar cursor = index;\nvar value;\n" + checks + "  cursor.push(add);\n}\nreturn index;";
    return (new Function("index", "adds", "removes", code)).bind(runtime);
}
function generateCollector2(keys) {
    var hashParts = [];
    for (var _i = 0; _i < keys.length; _i++) {
        var key = keys[_i];
        if (key.constructor === Array) {
            hashParts.push("add['" + key[0] + "']['" + key[1] + "']");
        }
        else {
            hashParts.push("add['" + key + "']");
        }
    }
    var code = "\n    var ixCache = cache.ix;\n    var idCache = cache.id;\n    for(var ix = 0, len = removes.length; ix < len; ix++) {\n      var remove = removes[ix];\n      var id = remove.__id;\n      var key = idCache[id];\n      var factIx = ixCache[id];\n      var facts = index[key];\n      //swap the last fact with this one to prevent holes\n      var lastFact = facts.pop();\n      if(lastFact && lastFact.__id !== remove.__id) {\n        facts[factIx] = lastFact;\n        ixCache[lastFact.__id] = factIx;\n      } else if(facts.length === 0) {\n        delete index[key];\n      }\n      delete idCache[id];\n      delete ixCache[id];\n    }\n    for(var ix = 0, len = adds.length; ix < len; ix++) {\n      var add = adds[ix];\n      var id = add.__id;\n      var key = idCache[id] = " + hashParts.join(" + '|' + ") + ";\n      if(index[key] === undefined) index[key] = [];\n      var arr = index[key];\n      ixCache[id] = arr.length;\n      arr.push(add);\n    }\n    return index;";
    return new Function("index", "adds", "removes", "cache", code);
}
function mergeArrays(as, bs) {
    var ix = as.length;
    var start = ix;
    for (var _i = 0; _i < bs.length; _i++) {
        var b = bs[_i];
        as[ix] = bs[ix - start];
        ix++;
    }
    return as;
}
var Diff = (function () {
    function Diff(ixer) {
        this.ixer = ixer;
        this.tables = {};
        this.length = 0;
        this.meta = {};
    }
    Diff.prototype.ensureTable = function (table) {
        var tableDiff = this.tables[table];
        if (!tableDiff) {
            tableDiff = this.tables[table] = { adds: [], removes: [] };
        }
        return tableDiff;
    };
    Diff.prototype.add = function (table, obj) {
        var tableDiff = this.ensureTable(table);
        this.length++;
        tableDiff.adds.push(obj);
        return this;
    };
    Diff.prototype.addMany = function (table, objs) {
        var tableDiff = this.ensureTable(table);
        this.length += objs.length;
        mergeArrays(tableDiff.adds, objs);
        return this;
    };
    Diff.prototype.removeFacts = function (table, objs) {
        var tableDiff = this.ensureTable(table);
        this.length += objs.length;
        mergeArrays(tableDiff.removes, objs);
        return this;
    };
    Diff.prototype.remove = function (table, query) {
        var tableDiff = this.ensureTable(table);
        var found = this.ixer.find(table, query);
        this.length += found.length;
        mergeArrays(tableDiff.removes, found);
        return this;
    };
    Diff.prototype.merge = function (diff) {
        for (var table in diff.tables) {
            var tableDiff = diff.tables[table];
            this.addMany(table, tableDiff.adds);
            this.removeFacts(table, tableDiff.removes);
        }
        return this;
    };
    Diff.prototype.reverse = function () {
        var reversed = new Diff(this.ixer);
        for (var table in this.tables) {
            var diff = this.tables[table];
            reversed.addMany(table, diff.removes);
            reversed.removeFacts(table, diff.adds);
        }
        return reversed;
    };
    return Diff;
})();
exports.Diff = Diff;
var Indexer = (function () {
    function Indexer() {
        this.tables = {};
        this.globalCount = 0;
        this.edbTables = {};
    }
    Indexer.prototype.addTable = function (name, keys) {
        if (keys === void 0) { keys = []; }
        var table = this.tables[name];
        keys = keys.filter(function (key) { return key !== "__id"; });
        if (table && keys.length) {
            table.fields = keys;
            table.stringify = generateStringFn(keys);
        }
        else {
            table = this.tables[name] = { table: [], hashToIx: {}, factHash: {}, indexes: {}, triggers: {}, fields: keys, stringify: generateStringFn(keys), keyLookup: {} };
            this.edbTables[name] = true;
        }
        for (var _i = 0; _i < keys.length; _i++) {
            var key = keys[_i];
            if (key.constructor === Array) {
                table.keyLookup[key[0]] = key;
            }
            else {
                table.keyLookup[key] = key;
            }
        }
        return table;
    };
    Indexer.prototype.clearTable = function (name) {
        var table = this.tables[name];
        if (!table)
            return;
        table.table = [];
        table.factHash = {};
        for (var indexName in table.indexes) {
            table.indexes[indexName].index = {};
            table.indexes[indexName].cache = { id: {}, ix: {} };
        }
    };
    Indexer.prototype.updateTable = function (tableId, adds, removes) {
        var table = this.tables[tableId];
        if (!table || !table.fields.length) {
            var example = adds[0] || removes[0];
            table = this.addTable(tableId, Object.keys(example));
        }
        var stringify = table.stringify;
        var facts = table.table;
        var factHash = table.factHash;
        var hashToIx = table.hashToIx;
        var localHash = {};
        var hashToFact = {};
        var hashes = [];
        for (var _i = 0; _i < adds.length; _i++) {
            var add = adds[_i];
            var hash = add.__id || stringify(add);
            if (localHash[hash] === undefined) {
                localHash[hash] = 1;
                hashToFact[hash] = add;
                hashes.push(hash);
            }
            else {
                localHash[hash]++;
            }
            add.__id = hash;
        }
        for (var _a = 0; _a < removes.length; _a++) {
            var remove = removes[_a];
            var hash = remove.__id || stringify(remove);
            if (localHash[hash] === undefined) {
                localHash[hash] = -1;
                hashToFact[hash] = remove;
                hashes.push(hash);
            }
            else {
                localHash[hash]--;
            }
            remove.__id = hash;
        }
        var realAdds = [];
        var realRemoves = [];
        for (var _b = 0; _b < hashes.length; _b++) {
            var hash = hashes[_b];
            var count = localHash[hash];
            if (count > 0 && !factHash[hash]) {
                var fact = hashToFact[hash];
                realAdds.push(fact);
                facts.push(fact);
                factHash[hash] = fact;
                hashToIx[hash] = facts.length - 1;
            }
            else if (count < 0 && factHash[hash]) {
                var fact = hashToFact[hash];
                var ix = hashToIx[hash];
                //swap the last fact with this one to prevent holes
                var lastFact = facts.pop();
                if (lastFact && lastFact.__id !== fact.__id) {
                    facts[ix] = lastFact;
                    hashToIx[lastFact.__id] = ix;
                }
                realRemoves.push(fact);
                delete factHash[hash];
                delete hashToIx[hash];
            }
        }
        return { adds: realAdds, removes: realRemoves };
    };
    Indexer.prototype.collector = function (keys) {
        return {
            index: {},
            cache: { id: {}, ix: {} },
            hasher: generateStringFn(keys),
            collect: generateCollector2(keys),
        };
    };
    Indexer.prototype.factToIndex = function (table, fact) {
        var keys = Object.keys(fact);
        if (!keys.length)
            return table.table.slice();
        var index = this.index(table, keys);
        var result = index.index[index.hasher(fact)];
        if (result) {
            return result.slice();
        }
        return [];
    };
    Indexer.prototype.execDiff = function (diff) {
        var triggers = {};
        var realDiffs = {};
        var tableIds = Object.keys(diff.tables);
        for (var _i = 0; _i < tableIds.length; _i++) {
            var tableId = tableIds[_i];
            var tableDiff = diff.tables[tableId];
            if (tableDiff.adds.length === 0 && tableDiff.removes.length === 0)
                continue;
            var realDiff = this.updateTable(tableId, tableDiff.adds, tableDiff.removes);
            // go through all the indexes and update them.
            var table = this.tables[tableId];
            var indexes = Object.keys(table.indexes);
            for (var _a = 0; _a < indexes.length; _a++) {
                var indexName = indexes[_a];
                var index = table.indexes[indexName];
                index.collect(index.index, realDiff.adds, realDiff.removes, index.cache);
            }
            var curTriggers = Object.keys(table.triggers);
            for (var _b = 0; _b < curTriggers.length; _b++) {
                var triggerName = curTriggers[_b];
                var trigger = table.triggers[triggerName];
                triggers[triggerName] = trigger;
            }
            realDiffs[tableId] = realDiff;
        }
        return { triggers: triggers, realDiffs: realDiffs };
    };
    Indexer.prototype.execTrigger = function (trigger) {
        var table = this.table(trigger.name);
        // since views might be changed during the triggering process, we want to favor
        // just using the view itself as the trigger if it is one. Otherwise, we use the
        // trigger's exec function. This ensures that if a view is recompiled and added
        // that any already queued triggers will use the updated version of the view instead
        // of the old queued one.
        var _a = (table.view ? table.view.exec() : trigger.exec()) || {}, _b = _a.results, results = _b === void 0 ? undefined : _b, _c = _a.unprojected, unprojected = _c === void 0 ? undefined : _c;
        if (!results)
            return;
        var prevResults = table.factHash;
        var prevHashes = Object.keys(prevResults);
        table.unprojected = unprojected;
        if (results) {
            var diff = new Diff(this);
            this.clearTable(trigger.name);
            diff.addMany(trigger.name, results);
            var triggers = this.execDiff(diff).triggers;
            var newHashes = table.factHash;
            if (prevHashes.length === Object.keys(newHashes).length) {
                var same = true;
                for (var _i = 0; _i < prevHashes.length; _i++) {
                    var hash = prevHashes[_i];
                    if (!newHashes[hash]) {
                        same = false;
                        break;
                    }
                }
                return same ? undefined : triggers;
            }
            else {
                return triggers;
            }
        }
        return;
    };
    Indexer.prototype.transitivelyClearTriggers = function (startingTriggers) {
        var cleared = {};
        var remaining = Object.keys(startingTriggers);
        for (var ix = 0; ix < remaining.length; ix++) {
            var trigger = remaining[ix];
            if (cleared[trigger])
                continue;
            this.clearTable(trigger);
            cleared[trigger] = true;
            remaining.push.apply(remaining, Object.keys(this.table(trigger).triggers));
        }
        return cleared;
    };
    Indexer.prototype.execTriggers = function (triggers) {
        var newTriggers = {};
        var retrigger = false;
        for (var triggerName in triggers) {
            // console.log("Calling:", triggerName);
            var trigger = triggers[triggerName];
            var nextRound = this.execTrigger(trigger);
            if (nextRound) {
                retrigger = true;
                for (var trigger_1 in nextRound) {
                    // console.log("Queuing:", trigger);
                    newTriggers[trigger_1] = nextRound[trigger_1];
                }
            }
        }
        if (retrigger) {
            return newTriggers;
        }
    };
    //---------------------------------------------------------
    // Indexer Public API
    //---------------------------------------------------------
    Indexer.prototype.serialize = function (asObject) {
        var dump = {};
        for (var tableName in this.tables) {
            var table = this.tables[tableName];
            if (!table.isView) {
                dump[tableName] = table.table;
            }
        }
        if (asObject) {
            return dump;
        }
        return JSON.stringify(dump);
    };
    Indexer.prototype.load = function (serialized) {
        var dump = JSON.parse(serialized);
        var diff = this.diff();
        for (var tableName in dump) {
            diff.addMany(tableName, dump[tableName]);
        }
        if (exports.INCREMENTAL) {
            this.applyDiffIncremental(diff);
        }
        else {
            this.applyDiff(diff);
        }
    };
    Indexer.prototype.diff = function () {
        return new Diff(this);
    };
    Indexer.prototype.applyDiff = function (diff) {
        if (exports.INCREMENTAL) {
            return this.applyDiffIncremental(diff);
        }
        var _a = this.execDiff(diff), triggers = _a.triggers, realDiffs = _a.realDiffs;
        var cleared;
        var round = 0;
        if (triggers)
            cleared = this.transitivelyClearTriggers(triggers);
        while (triggers) {
            for (var trigger in triggers) {
                cleared[trigger] = false;
            }
            // console.group(`ROUND ${round}`);
            triggers = this.execTriggers(triggers);
            round++;
        }
        for (var _i = 0, _b = Object.keys(cleared); _i < _b.length; _i++) {
            var trigger = _b[_i];
            if (!cleared[trigger])
                continue;
            var view = this.table(trigger).view;
            if (view) {
                this.execTrigger(view);
            }
        }
    };
    Indexer.prototype.table = function (tableId) {
        var table = this.tables[tableId];
        if (table)
            return table;
        return this.addTable(tableId);
    };
    Indexer.prototype.index = function (tableOrId, keys) {
        var table;
        if (typeof tableOrId === "string")
            table = this.table(tableOrId);
        else
            table = tableOrId;
        keys.sort();
        var indexName = keys.filter(function (key) { return key !== "__id"; }).join("|");
        var index = table.indexes[indexName];
        if (!index) {
            var tableKeys = [];
            for (var _i = 0; _i < keys.length; _i++) {
                var key = keys[_i];
                tableKeys.push(table.keyLookup[key] || key);
            }
            index = table.indexes[indexName] = this.collector(tableKeys);
            index.collect(index.index, table.table, [], index.cache);
        }
        return index;
    };
    Indexer.prototype.find = function (tableId, query) {
        var table = this.tables[tableId];
        if (!table) {
            return [];
        }
        else if (!query) {
            return table.table.slice();
        }
        else {
            return this.factToIndex(table, query);
        }
    };
    Indexer.prototype.findOne = function (tableId, query) {
        return this.find(tableId, query)[0];
    };
    Indexer.prototype.query = function (name) {
        if (name === void 0) { name = "unknown"; }
        return new Query(this, name);
    };
    Indexer.prototype.union = function (name) {
        return new Union(this, name);
    };
    Indexer.prototype.trigger = function (name, table, exec, execIncremental) {
        var tables = (typeof table === "string") ? [table] : table;
        var trigger = { name: name, tables: tables, exec: exec, execIncremental: execIncremental };
        for (var _i = 0; _i < tables.length; _i++) {
            var tableId = tables[_i];
            var table_2 = this.table(tableId);
            table_2.triggers[name] = trigger;
        }
        if (!exports.INCREMENTAL) {
            var nextRound = this.execTrigger(trigger);
            while (nextRound) {
                nextRound = this.execTriggers(nextRound);
            }
            ;
        }
        else {
            if (!tables.length) {
                return exec(this);
            }
            var initial = (_a = {}, _a[tables[0]] = { adds: this.tables[tables[0]].table, removes: [] }, _a);
            var _b = this.execTriggerIncremental(trigger, initial), triggers = _b.triggers, changes = _b.changes;
            while (triggers) {
                var results = this.execTriggersIncremental(triggers, changes);
                if (!results)
                    break;
                triggers = results.triggers;
                changes = results.changes;
            }
        }
        var _a;
    };
    Indexer.prototype.asView = function (query) {
        var name = query.name;
        if (this.tables[name]) {
            this.removeView(name);
        }
        var view = this.table(name);
        this.edbTables[name] = false;
        view.view = query;
        view.isView = true;
        this.trigger(name, query.tables, query.exec.bind(query), query.execIncremental.bind(query));
    };
    Indexer.prototype.removeView = function (id) {
        for (var _i = 0, _a = this.tables; _i < _a.length; _i++) {
            var table = _a[_i];
            delete table.triggers[id];
        }
    };
    Indexer.prototype.totalFacts = function () {
        var total = 0;
        for (var tableName in this.tables) {
            total += this.tables[tableName].table.length;
        }
        return total;
    };
    Indexer.prototype.factsPerTable = function () {
        var info = {};
        for (var tableName in this.tables) {
            info[tableName] = this.tables[tableName].table.length;
        }
        return info;
    };
    Indexer.prototype.applyDiffIncremental = function (diff) {
        if (diff.length === 0)
            return;
        // console.log("DIFF SIZE: ", diff.length, diff);
        var _a = this.execDiff(diff), triggers = _a.triggers, realDiffs = _a.realDiffs;
        var round = 0;
        var changes = realDiffs;
        while (triggers) {
            // console.group(`ROUND ${round}`);
            // console.log("CHANGES: ", changes);
            var results = this.execTriggersIncremental(triggers, changes);
            // console.groupEnd();
            if (!results)
                break;
            triggers = results.triggers;
            changes = results.changes;
            round++;
        }
    };
    Indexer.prototype.execTriggerIncremental = function (trigger, changes) {
        var table = this.table(trigger.name);
        var adds, provenance, removes, info;
        if (trigger.execIncremental) {
            info = trigger.execIncremental(changes, table) || {};
            adds = info.adds;
            removes = info.removes;
        }
        else {
            trigger.exec();
            return;
        }
        var diff = new runtime.Diff(this);
        if (adds.length) {
            diff.addMany(trigger.name, adds);
        }
        if (removes.length) {
            diff.removeFacts(trigger.name, removes);
        }
        var updated = this.execDiff(diff);
        var realDiffs = updated.realDiffs;
        if (realDiffs[trigger.name] && (realDiffs[trigger.name].adds.length || realDiffs[trigger.name].removes)) {
            return { changes: realDiffs[trigger.name], triggers: updated.triggers };
        }
        else {
            return {};
        }
    };
    Indexer.prototype.execTriggersIncremental = function (triggers, changes) {
        var newTriggers = {};
        var nextChanges = {};
        var retrigger = false;
        var triggerKeys = Object.keys(triggers);
        for (var _i = 0; _i < triggerKeys.length; _i++) {
            var triggerName = triggerKeys[_i];
            // console.log("Calling:", triggerName);
            var trigger = triggers[triggerName];
            var nextRound = this.execTriggerIncremental(trigger, changes);
            if (nextRound && nextRound.changes) {
                nextChanges[triggerName] = nextRound.changes;
                if (nextRound.triggers) {
                    var nextRoundKeys = Object.keys(nextRound.triggers);
                    for (var _a = 0; _a < nextRoundKeys.length; _a++) {
                        var trigger_2 = nextRoundKeys[_a];
                        if (trigger_2 && nextRound.triggers[trigger_2]) {
                            retrigger = true;
                            // console.log("Queuing:", trigger);
                            newTriggers[trigger_2] = nextRound.triggers[trigger_2];
                        }
                    }
                }
            }
        }
        if (retrigger) {
            return { changes: nextChanges, triggers: newTriggers };
        }
    };
    return Indexer;
})();
exports.Indexer = Indexer;
function addProvenanceTable(ixer) {
    var table = ixer.addTable("provenance", ["table", ["row", "__id"], "row instance", "source", ["source row", "__id"]]);
    // generate some indexes that we know we're going to need upfront
    ixer.index("provenance", ["table", "row"]);
    ixer.index("provenance", ["table", "row instance"]);
    ixer.index("provenance", ["table", "source", "source row"]);
    ixer.index("provenance", ["table"]);
    return ixer;
}
exports.addProvenanceTable = addProvenanceTable;
function mappingToDiff(diff, action, mapping, aliases, reverseLookup) {
    for (var from in mapping) {
        var to = mapping[from];
        if (to.constructor === Array) {
            var source = to[0];
            if (typeof source === "number") {
                source = aliases[reverseLookup[source]];
            }
            else {
                source = aliases[source];
            }
            diff.add("action mapping", { action: action, from: from, "to source": source, "to field": to[1] });
        }
        else {
            diff.add("action mapping constant", { action: action, from: from, value: to });
        }
    }
    return diff;
}
exports.QueryFunctions = {};
var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/mg;
var ARGUMENT_NAMES = /([^\s,]+)/g;
function getParamNames(func) {
    var fnStr = func.toString().replace(STRIP_COMMENTS, '');
    var result = fnStr.slice(fnStr.indexOf('(') + 1, fnStr.indexOf(')')).match(ARGUMENT_NAMES);
    if (result === null)
        result = [];
    return result;
}
function define(name, opts, func) {
    var params = getParamNames(func);
    opts.name = name;
    opts.params = params;
    opts.func = func;
    exports.QueryFunctions[name] = opts;
}
exports.define = define;
var Query = (function () {
    function Query(ixer, name) {
        if (name === void 0) { name = "unknown"; }
        this.name = name;
        this.ixer = ixer;
        this.dirty = true;
        this.tables = [];
        this.joins = [];
        this.aliases = {};
        this.funcs = [];
        this.aggregates = [];
        this.unprojectedSize = 0;
        this.hasOrdinal = false;
    }
    Query.remove = function (view, ixer) {
        var diff = ixer.diff();
        diff.remove("view", { view: view });
        for (var _i = 0, _a = ixer.find("action", { view: view }); _i < _a.length; _i++) {
            var actionItem = _a[_i];
            var action = actionItem.action;
            diff.remove("action", { action: action });
            diff.remove("action source", { action: action });
            diff.remove("action mapping", { action: action });
            diff.remove("action mapping constant", { action: action });
            diff.remove("action mapping sorted", { action: action });
            diff.remove("action mapping limit", { action: action });
        }
        return diff;
    };
    Query.prototype.changeset = function (ixer) {
        var diff = ixer.diff();
        var aliases = {};
        var reverseLookup = {};
        for (var alias in this.aliases) {
            reverseLookup[this.aliases[alias]] = alias;
        }
        var view = this.name;
        diff.add("view", { view: view, kind: "query" });
        //joins
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var action = utils_1.uuid();
            aliases[join.as] = action;
            if (!join.negated) {
                diff.add("action", { view: view, action: action, kind: "select", ix: join.ix });
            }
            else {
                diff.add("action", { view: view, action: action, kind: "deselect", ix: join.ix });
            }
            diff.add("action source", { action: action, "source view": join.table });
            mappingToDiff(diff, action, join.join, aliases, reverseLookup);
        }
        //functions
        for (var _b = 0, _c = this.funcs; _b < _c.length; _b++) {
            var func = _c[_b];
            var action = utils_1.uuid();
            aliases[func.as] = action;
            diff.add("action", { view: view, action: action, kind: "calculate", ix: func.ix });
            diff.add("action source", { action: action, "source view": func.name });
            mappingToDiff(diff, action, func.args, aliases, reverseLookup);
        }
        //aggregates
        for (var _d = 0, _e = this.aggregates; _d < _e.length; _d++) {
            var agg = _e[_d];
            var action = utils_1.uuid();
            aliases[agg.as] = action;
            diff.add("action", { view: view, action: action, kind: "aggregate", ix: agg.ix });
            diff.add("action source", { action: action, "source view": agg.name });
            mappingToDiff(diff, action, agg.args, aliases, reverseLookup);
        }
        //sort
        if (this.sorts) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "sort", ix: exports.MAX_NUMBER });
            var ix = 0;
            for (var _f = 0, _g = this.sorts; _f < _g.length; _f++) {
                var sort = _g[_f];
                var source = sort[0], field = sort[1], direction = sort[2];
                if (typeof source === "number") {
                    source = aliases[reverseLookup[source]];
                }
                else {
                    source = aliases[source];
                }
                diff.add("action mapping sorted", { action: action, ix: ix, source: source, field: field, direction: direction });
                ix++;
            }
        }
        //group
        if (this.groups) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "group", ix: exports.MAX_NUMBER });
            var ix = 0;
            for (var _h = 0, _j = this.groups; _h < _j.length; _h++) {
                var group = _j[_h];
                var source = group[0], field = group[1];
                if (typeof source === "number") {
                    source = aliases[reverseLookup[source]];
                }
                else {
                    source = aliases[source];
                }
                diff.add("action mapping sorted", { action: action, ix: ix, source: source, field: field, direction: "ascending" });
                ix++;
            }
        }
        //limit
        if (this.limitInfo) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "limit", ix: exports.MAX_NUMBER });
            for (var limitType in this.limitInfo) {
                diff.add("action mapping limit", { action: action, "limit type": limitType, value: this.limitInfo[limitType] });
            }
        }
        //projection
        if (this.projectionMap) {
            var action = utils_1.uuid();
            diff.add("action", { view: view, action: action, kind: "project", ix: exports.MAX_NUMBER });
            mappingToDiff(diff, action, this.projectionMap, aliases, reverseLookup);
        }
        return diff;
    };
    Query.prototype.validateFields = function (tableName, joinObject) {
        var table = this.ixer.table(tableName);
        for (var field in joinObject) {
            if (table.fields.length && !table.keyLookup[field]) {
                throw new Error("Table '" + tableName + "' doesn't have a field '" + field + "'.\n\nAvailable fields: " + table.fields.join(", "));
            }
            var joinInfo = joinObject[field];
            if (joinInfo.constructor === Array) {
                var joinNumber = joinInfo[0], referencedField = joinInfo[1];
                if (typeof joinNumber !== "number") {
                    joinNumber = this.aliases[joinNumber];
                }
                var join = this.joins[joinNumber];
                if (join && join.ix === joinNumber) {
                    var referencedTable = this.ixer.table(join.table);
                    if (!referencedTable.fields.length)
                        continue;
                    if (!referencedTable.keyLookup[referencedField]) {
                        throw new Error("Table '" + join.table + "' doesn't have a field '" + referencedField + "'.\n\nAvailable fields: " + referencedTable.fields.join(", "));
                    }
                }
            }
        }
    };
    Query.prototype.select = function (table, join, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        this.unprojectedSize++;
        this.tables.push(table);
        this.validateFields(table, join);
        this.joins.push({ negated: false, table: table, join: join, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.deselect = function (table, join) {
        this.dirty = true;
        this.tables.push(table);
        this.validateFields(table, join);
        this.joins.push({ negated: true, table: table, join: join, ix: this.joins.length * 1000 });
        return this;
    };
    Query.prototype.calculate = function (funcName, args, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        if (!exports.QueryFunctions[funcName].filter) {
            this.unprojectedSize++;
        }
        this.funcs.push({ name: funcName, args: args, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.project = function (projectionMap) {
        this.projectionMap = projectionMap;
        this.validateFields(undefined, projectionMap);
        return this;
    };
    Query.prototype.group = function (groups) {
        this.dirty = true;
        if (groups[0] && groups[0].constructor === Array) {
            this.groups = groups;
        }
        else {
            if (!this.groups)
                this.groups = [];
            this.groups.push(groups);
        }
        return this;
    };
    Query.prototype.sort = function (sorts) {
        this.dirty = true;
        if (sorts[0] && sorts[0].constructor === Array) {
            this.sorts = sorts;
        }
        else {
            if (!this.sorts)
                this.sorts = [];
            this.sorts.push(sorts);
        }
        return this;
    };
    Query.prototype.limit = function (limitInfo) {
        this.dirty = true;
        if (!this.limitInfo) {
            this.limitInfo = {};
        }
        for (var key in limitInfo) {
            this.limitInfo[key] = limitInfo[key];
        }
        return this;
    };
    Query.prototype.aggregate = function (funcName, args, as) {
        this.dirty = true;
        if (as) {
            this.aliases[as] = Object.keys(this.aliases).length;
        }
        this.unprojectedSize++;
        this.aggregates.push({ name: funcName, args: args, as: as, ix: this.aliases[as] });
        return this;
    };
    Query.prototype.ordinal = function () {
        this.dirty = true;
        this.hasOrdinal = true;
        this.unprojectedSize++;
        return this;
    };
    Query.prototype.applyAliases = function (joinMap) {
        for (var field in joinMap) {
            var joinInfo = joinMap[field];
            if (joinInfo.constructor !== Array || typeof joinInfo[0] === "number")
                continue;
            var joinTable = joinInfo[0];
            if (joinTable === "ordinal") {
                joinInfo[0] = this.unprojectedSize - 1;
            }
            else if (this.aliases[joinTable] !== undefined) {
                joinInfo[0] = this.aliases[joinTable];
            }
            else {
                throw new Error("Invalid alias used: " + joinTable);
            }
        }
    };
    Query.prototype.toAST = function () {
        var cursor = { type: "query",
            children: [] };
        var root = cursor;
        var results = [];
        // by default the only thing we return are the unprojected results
        var returns = ["unprojected", "provenance"];
        // we need an array to store our unprojected results
        root.children.push({ type: "declaration", var: "unprojected", value: "[]" });
        root.children.push({ type: "declaration", var: "provenance", value: "[]" });
        root.children.push({ type: "declaration", var: "projected", value: "{}" });
        // run through each table nested in the order they were given doing pairwise
        // joins along the way.
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var table = join.table, ix = join.ix, negated = join.negated;
            var cur = {
                type: "select",
                table: table,
                passed: ix === 0,
                ix: ix,
                negated: negated,
                children: [],
                join: false,
            };
            // we only want to eat the cost of dealing with indexes
            // if we are actually joining on something
            var joinMap = join.join;
            this.applyAliases(joinMap);
            if (joinMap && Object.keys(joinMap).length !== 0) {
                root.children.unshift({ type: "declaration", var: "query" + ix, value: "{}" });
                cur.join = joinMap;
            }
            cursor.children.push(cur);
            if (!negated) {
                results.push({ type: "select", ix: ix });
            }
            cursor = cur;
        }
        // at the bottom of the joins, we calculate all the functions based on the values
        // collected
        for (var _b = 0, _c = this.funcs; _b < _c.length; _b++) {
            var func = _c[_b];
            var args = func.args, name_1 = func.name, ix = func.ix;
            var funcInfo = exports.QueryFunctions[name_1];
            this.applyAliases(args);
            root.children.unshift({ type: "functionDeclaration", ix: ix, info: funcInfo });
            if (funcInfo.multi || funcInfo.filter) {
                var node = { type: "functionCallMultiReturn", ix: ix, args: args, info: funcInfo, children: [] };
                cursor.children.push(node);
                cursor = node;
            }
            else {
                cursor.children.push({ type: "functionCall", ix: ix, args: args, info: funcInfo, children: [] });
            }
            if (!funcInfo.noReturn && !funcInfo.filter) {
                results.push({ type: "function", ix: ix });
            }
        }
        // now that we're at the bottom of the join, store the unprojected result
        cursor.children.push({ type: "result", results: results });
        //Aggregation
        //sort the unprojected results based on groupings and the given sorts
        var sorts = [];
        var alreadySorted = {};
        if (this.groups) {
            this.applyAliases(this.groups);
            for (var _d = 0, _e = this.groups; _d < _e.length; _d++) {
                var group = _e[_d];
                var table = group[0], field = group[1];
                sorts.push(group);
                alreadySorted[(table + "|" + field)] = true;
            }
        }
        if (this.sorts) {
            this.applyAliases(this.sorts);
            for (var _f = 0, _g = this.sorts; _f < _g.length; _f++) {
                var sort = _g[_f];
                var table = sort[0], field = sort[1];
                if (!alreadySorted[(table + "|" + field)]) {
                    sorts.push(sort);
                }
            }
        }
        var size = this.unprojectedSize;
        if (sorts.length) {
            root.children.push({ type: "sort", sorts: sorts, size: size, children: [] });
        }
        //then we need to run through the sorted items and do the aggregate as a fold.
        if (this.aggregates.length || sorts.length || this.limitInfo || this.hasOrdinal) {
            // we need to store group info for post processing of the unprojected results
            // this will indicate what group number, if any, that each unprojected result belongs to
            root.children.unshift({ type: "declaration", var: "groupInfo", value: "[]" });
            returns.push("groupInfo");
            var aggregateChildren = [];
            for (var _h = 0, _j = this.aggregates; _h < _j.length; _h++) {
                var func = _j[_h];
                var args = func.args, name_2 = func.name, ix = func.ix;
                var funcInfo = exports.QueryFunctions[name_2];
                this.applyAliases(args);
                root.children.unshift({ type: "functionDeclaration", ix: ix, info: funcInfo });
                aggregateChildren.push({ type: "functionCall", ix: ix, resultsIx: results.length, args: args, info: funcInfo, unprojected: true, children: [] });
                results.push({ type: "placeholder" });
            }
            if (this.hasOrdinal === true) {
                aggregateChildren.push({ type: "ordinal" });
                results.push({ type: "placeholder" });
            }
            var aggregate = { type: "aggregate loop", groups: this.groups, limit: this.limitInfo, size: size, children: aggregateChildren };
            root.children.push(aggregate);
            cursor = aggregate;
        }
        if (this.projectionMap) {
            this.applyAliases(this.projectionMap);
            root.children.unshift({ type: "declaration", var: "results", value: "[]" });
            if (exports.INCREMENTAL) {
                cursor.children.push({ type: "provenance" });
            }
            cursor.children.push({ type: "projection", projectionMap: this.projectionMap, unprojected: this.aggregates.length });
            returns.push("results");
        }
        root.children.push({ type: "return", vars: returns });
        return root;
    };
    Query.prototype.compileParamString = function (funcInfo, args, unprojected) {
        if (unprojected === void 0) { unprojected = false; }
        var code = "";
        var params = funcInfo.params;
        if (unprojected)
            params = params.slice(1);
        for (var _i = 0; _i < params.length; _i++) {
            var param = params[_i];
            var arg = args[param];
            var argCode = void 0;
            if (arg.constructor === Array) {
                var property = "";
                if (arg[1]) {
                    property = "['" + arg[1] + "']";
                }
                if (!unprojected) {
                    argCode = "row" + arg[0] + property;
                }
                else {
                    argCode = "unprojected[ix + " + arg[0] + "]" + property;
                }
            }
            else {
                argCode = JSON.stringify(arg);
            }
            code += argCode + ", ";
        }
        return code.substring(0, code.length - 2);
    };
    Query.prototype.compileAST = function (root) {
        var code = "";
        var type = root.type;
        switch (type) {
            case "query":
                for (var _i = 0, _a = root.children; _i < _a.length; _i++) {
                    var child = _a[_i];
                    code += this.compileAST(child);
                }
                break;
            case "declaration":
                code += "var " + root.var + " = " + root.value + ";\n";
                break;
            case "functionDeclaration":
                code += "var func" + root.ix + " = QueryFunctions['" + root.info.name + "'].func;\n";
                break;
            case "functionCall":
                var ix = root.ix;
                var prev = "";
                if (root.unprojected) {
                    prev = "row" + ix;
                    if (root.info.params.length > 1)
                        prev += ",";
                }
                code += "var row" + ix + " = func" + ix + "(" + prev + this.compileParamString(root.info, root.args, root.unprojected) + ");\n";
                break;
            case "functionCallMultiReturn":
                var ix = root.ix;
                code += "var rows" + ix + " = func" + ix + "(" + this.compileParamString(root.info, root.args) + ");\n";
                code += "for(var funcResultIx" + ix + " = 0, funcLen" + ix + " = rows" + ix + ".length; funcResultIx" + ix + " < funcLen" + ix + "; funcResultIx" + ix + "++) {\n";
                code += "var row" + ix + " = rows" + ix + "[funcResultIx" + ix + "];\n";
                for (var _b = 0, _c = root.children; _b < _c.length; _b++) {
                    var child = _c[_b];
                    code += this.compileAST(child);
                }
                code += "}\n";
                break;
            case "select":
                var ix = root.ix;
                if (root.passed) {
                    code += "var rows" + ix + " = rootRows;\n";
                }
                else if (root.join) {
                    for (var key in root.join) {
                        var mapping = root.join[key];
                        if (mapping.constructor === Array) {
                            var tableIx = mapping[0], value = mapping[1];
                            code += "query" + ix + "['" + key + "'] = row" + tableIx + "['" + value + "'];\n";
                        }
                        else {
                            code += "query" + ix + "['" + key + "'] = " + JSON.stringify(mapping) + ";\n";
                        }
                    }
                    code += "var rows" + ix + " = ixer.factToIndex(ixer.table('" + root.table + "'), query" + ix + ");\n";
                }
                else {
                    code += "var rows" + ix + " = ixer.table('" + root.table + "').table;\n";
                }
                if (!root.negated) {
                    code += "for(var rowIx" + ix + " = 0, rowsLen" + ix + " = rows" + ix + ".length; rowIx" + ix + " < rowsLen" + ix + "; rowIx" + ix + "++) {\n";
                    code += "var row" + ix + " = rows" + ix + "[rowIx" + ix + "];\n";
                }
                else {
                    code += "if(!rows" + ix + ".length) {\n";
                }
                for (var _d = 0, _e = root.children; _d < _e.length; _d++) {
                    var child = _e[_d];
                    code += this.compileAST(child);
                }
                code += "}\n";
                break;
            case "result":
                var results = [];
                for (var _f = 0, _g = root.results; _f < _g.length; _f++) {
                    var result = _g[_f];
                    if (result.type === "placeholder") {
                        results.push("undefined");
                    }
                    else {
                        var ix_1 = result.ix;
                        results.push("row" + ix_1);
                    }
                }
                code += "unprojected.push(" + results.join(", ") + ");\n";
                break;
            case "sort":
                code += generateUnprojectedSorterCode(root.size, root.sorts) + "\n";
                break;
            case "aggregate loop":
                var projection = "";
                var aggregateCalls = [];
                var aggregateStates = [];
                var aggregateResets = [];
                var unprojected = {};
                var ordinal = false;
                var provenanceCode;
                for (var _h = 0, _j = root.children; _h < _j.length; _h++) {
                    var agg = _j[_h];
                    if (agg.type === "functionCall") {
                        unprojected[agg.ix] = true;
                        var compiled = this.compileAST(agg);
                        compiled += "\nunprojected[ix + " + agg.resultsIx + "] = row" + agg.ix + ";\n";
                        aggregateCalls.push(compiled);
                        aggregateStates.push("var row" + agg.ix + " = {};");
                        aggregateResets.push("row" + agg.ix + " = {};");
                    }
                    else if (agg.type === "projection") {
                        agg.unprojected = unprojected;
                        projection = this.compileAST(agg);
                    }
                    else if (agg.type === "ordinal") {
                        ordinal = "unprojected[ix+" + (this.unprojectedSize - 1) + "] = resultCount;\n";
                    }
                    else if (agg.type === "provenance") {
                        provenanceCode = this.compileAST(agg);
                    }
                }
                var aggregateCallsCode = aggregateCalls.join("");
                var differentGroupChecks = [];
                var groupCheck = "false";
                if (root.groups) {
                    for (var _k = 0, _l = root.groups; _k < _l.length; _k++) {
                        var group = _l[_k];
                        var table = group[0], field = group[1];
                        differentGroupChecks.push("unprojected[nextIx + " + table + "]['" + field + "'] !== unprojected[ix + " + table + "]['" + field + "']");
                    }
                    groupCheck = "(" + differentGroupChecks.join(" || ") + ")";
                }
                var resultsCheck = "";
                if (root.limit && root.limit.results) {
                    var limitValue = root.limit.results;
                    var offset = root.limit.offset;
                    if (offset) {
                        limitValue += offset;
                        projection = "if(resultCount >= " + offset + ") {\n              " + projection + "\n            }";
                    }
                    resultsCheck = "if(resultCount === " + limitValue + ") break;";
                }
                var groupLimitCheck = "";
                if (root.limit && root.limit.perGroup && root.groups) {
                    var limitValue = root.limit.perGroup;
                    var offset = root.limit.offset;
                    if (offset) {
                        limitValue += offset;
                        aggregateCallsCode = "if(perGroupCount >= " + offset + ") {\n              " + aggregateCallsCode + "\n            }";
                    }
                    groupLimitCheck = "if(perGroupCount === " + limitValue + ") {\n            while(!differentGroup) {\n              nextIx += " + root.size + ";\n              if(nextIx >= len) break;\n              groupInfo[nextIx] = undefined;\n              differentGroup = " + groupCheck + ";\n            }\n          }";
                }
                var groupDifference = "";
                var groupInfo = "";
                if (this.groups) {
                    groupInfo = "groupInfo[ix] = resultCount;";
                    var groupProjection = projection + "resultCount++;";
                    if (root.limit && root.limit.offset) {
                        groupProjection = "if(perGroupCount > " + root.limit.offset + ") {\n              " + groupProjection + "\n            }";
                        groupInfo = "if(perGroupCount >= " + root.limit.offset + ") {\n              " + groupInfo + "\n            }";
                    }
                    groupDifference = "\n          perGroupCount++\n          var differentGroup = " + groupCheck + ";\n          " + groupLimitCheck + "\n          if(differentGroup) {\n            " + groupProjection + "\n            " + aggregateResets.join("\n") + "\n            perGroupCount = 0;\n          }\n";
                }
                else {
                    groupDifference = "resultCount++;\n";
                    groupInfo = "groupInfo[ix] = 0;";
                }
                // if there are neither aggregates to calculate nor groups to build,
                // then we just need to worry about limiting
                if (!this.groups && aggregateCalls.length === 0) {
                    code = "var ix = 0;\n                  var resultCount = 0;\n                  var len = unprojected.length;\n                  while(ix < len) {\n                    " + resultsCheck + "\n                    " + (ordinal || "") + "\n                    " + provenanceCode + "\n                    " + projection + "\n                    groupInfo[ix] = resultCount;\n                    resultCount++;\n                    ix += " + root.size + ";\n                  }\n";
                    break;
                }
                code = "var resultCount = 0;\n                var perGroupCount = 0;\n                var ix = 0;\n                var nextIx = 0;\n                var len = unprojected.length;\n                " + aggregateStates.join("\n") + "\n                while(ix < len) {\n                  " + aggregateCallsCode + "\n                  " + groupInfo + "\n                  " + (ordinal || "") + "\n                  " + provenanceCode + "\n                  if(ix + " + root.size + " === len) {\n                    " + projection + "\n                    break;\n                  }\n                  nextIx += " + root.size + ";\n                  " + groupDifference + "\n                  " + resultsCheck + "\n                  ix = nextIx;\n                }\n";
                break;
            case "projection":
                var projectedVars = [];
                var idStringParts = [];
                for (var newField in root.projectionMap) {
                    var mapping = root.projectionMap[newField];
                    var value = "";
                    if (mapping.constructor === Array) {
                        if (mapping[1] === undefined) {
                            value = "unprojected[ix + " + mapping[0] + "]";
                        }
                        else if (!root.unprojected || root.unprojected[mapping[0]]) {
                            value = "row" + mapping[0] + "['" + mapping[1] + "']";
                        }
                        else {
                            value = "unprojected[ix + " + mapping[0] + "]['" + mapping[1] + "']";
                        }
                    }
                    else {
                        value = JSON.stringify(mapping);
                    }
                    projectedVars.push("projected['" + newField.replace(/'/g, "\\'") + "'] = " + value);
                    idStringParts.push(value);
                }
                code += projectedVars.join(";\n") + "\n";
                code += "projected.__id = " + idStringParts.join(" + \"|\" + ") + ";\n";
                code += "results.push(projected);\n";
                code += "projected = {};\n";
                break;
            case "provenance":
                var provenance = "var provenance__id = '';\n";
                var ids = [];
                for (var _m = 0, _o = this.joins; _m < _o.length; _m++) {
                    var join = _o[_m];
                    if (join.negated)
                        continue;
                    provenance += "provenance__id = tableId + '|' + projected.__id + '|' + rowInstance + '|" + join.table + "|' + row" + join.ix + ".__id; \n";
                    provenance += "provenance.push({table: tableId, row: projected, \"row instance\": rowInstance, source: \"" + join.table + "\", \"source row\": row" + join.ix + "});\n";
                    ids.push("row" + join.ix + ".__id");
                }
                code = "var rowInstance = " + ids.join(" + '|' + ") + ";\n        " + provenance;
                break;
            case "return":
                var returns = [];
                for (var _p = 0, _q = root.vars; _p < _q.length; _p++) {
                    var curVar = _q[_p];
                    returns.push(curVar + ": " + curVar);
                }
                code += "return {" + returns.join(", ") + "};";
                break;
        }
        return code;
    };
    // given a set of changes and a join order, determine the root facts that need
    // to be joined again to cover all the adds
    Query.prototype.reverseJoin = function (joins) {
        var changed = joins[0];
        var reverseJoinMap = {};
        // collect all the constraints and reverse them
        for (var _i = 0; _i < joins.length; _i++) {
            var join = joins[_i];
            for (var key in join.join) {
                var _a = join.join[key], source = _a[0], field = _a[1];
                if (source <= changed.ix) {
                    if (!reverseJoinMap[source]) {
                        reverseJoinMap[source] = {};
                    }
                    if (!reverseJoinMap[source][field])
                        reverseJoinMap[source][field] = [join.ix, key];
                }
            }
        }
        var recurse = function (joins, joinIx) {
            var code = "";
            if (joinIx >= joins.length) {
                return "others.push(row0)";
            }
            var _a = joins[joinIx], table = _a.table, ix = _a.ix, negated = _a.negated;
            var joinMap = joins[joinIx].join;
            // we only care about this guy if he's joined with at least one thing
            if (!reverseJoinMap[ix] && joinIx < joins.length - 1)
                return recurse(joins, joinIx + 1);
            else if (!reverseJoinMap)
                return "";
            var mappings = [];
            for (var key in reverseJoinMap[ix]) {
                var _b = reverseJoinMap[ix][key], sourceIx = _b[0], field = _b[1];
                if (sourceIx === changed.ix || reverseJoinMap[sourceIx] !== undefined) {
                    mappings.push("'" + key + "': row" + sourceIx + "['" + field + "']");
                }
            }
            for (var key in joinMap) {
                var value = joinMap[key];
                if (value.constructor !== Array) {
                    mappings.push("'" + key + "': " + JSON.stringify(value));
                }
            }
            if (negated) {
            }
            code += "\n            var rows" + ix + " = eve.find('" + table + "', {" + mappings.join(", ") + "});\n            for(var rowsIx" + ix + " = 0, rowsLen" + ix + " = rows" + ix + ".length; rowsIx" + ix + " < rowsLen" + ix + "; rowsIx" + ix + "++) {\n                var row" + ix + " = rows" + ix + "[rowsIx" + ix + "];\n                " + recurse(joins, joinIx + 1) + "\n            }\n            ";
            return code;
        };
        return recurse(joins, 1);
    };
    Query.prototype.compileIncrementalRowFinderCode = function () {
        var code = "var others = [];\n";
        var reversed = this.joins.slice().reverse();
        var checks = [];
        var ix = 0;
        for (var _i = 0; _i < reversed.length; _i++) {
            var join = reversed[_i];
            // we don't want to do this for the root
            if (ix === reversed.length - 1)
                break;
            checks.push("\n\t\t\tif(changes[\"" + join.table + "\"] && changes[\"" + join.table + "\"].adds) {\n                var curChanges" + join.ix + " = changes[\"" + join.table + "\"].adds;\n                for(var changeIx" + join.ix + " = 0, changeLen" + join.ix + " = curChanges" + join.ix + ".length; changeIx" + join.ix + " < changeLen" + join.ix + "; changeIx" + join.ix + "++) {\n                    var row" + join.ix + " = curChanges" + join.ix + "[changeIx" + join.ix + "];\n\t\t\t\t\t" + this.reverseJoin(reversed.slice(ix)) + "\n\t\t\t\t}\n\t\t\t}");
            ix++;
        }
        code += checks.join(" else");
        var last = reversed[ix];
        code += "\n\t\t\tif(changes[\"" + last.table + "\"] && changes[\"" + last.table + "\"].adds) {\n                var curChanges = changes[\"" + last.table + "\"].adds;\n\t\t\t\tfor(var changeIx = 0, changeLen = curChanges.length; changeIx < changeLen; changeIx++) {\n\t\t\t\t\tothers.push(curChanges[changeIx]);\n\t\t\t\t}\n\t\t\t}\n\t\t\treturn others;";
        return code;
    };
    Query.prototype.incrementalRemove = function (changes) {
        var ixer = this.ixer;
        var rowsToPostCheck = [];
        var provenanceDiff = this.ixer.diff();
        var removes = [];
        var indexes = ixer.table("provenance").indexes;
        var sourceRowLookup = indexes["source|source row|table"].index;
        var rowInstanceLookup = indexes["row instance|table"].index;
        var tableRowLookup = indexes["row|table"].index;
        var provenanceRemoves = [];
        var visited = {};
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            var change = changes[join.table];
            if (!visited[join.table] && change && change.removes.length) {
                visited[join.table] = true;
                for (var _b = 0, _c = change.removes; _b < _c.length; _b++) {
                    var remove = _c[_b];
                    var provenances = sourceRowLookup[join.table + '|' + remove.__id + '|' + this.name];
                    if (provenances) {
                        for (var _d = 0; _d < provenances.length; _d++) {
                            var provenance = provenances[_d];
                            if (!visited[provenance["row instance"]]) {
                                visited[provenance["row instance"]] = true;
                                var relatedProvenance = rowInstanceLookup[provenance["row instance"] + '|' + provenance.table];
                                for (var _e = 0; _e < relatedProvenance.length; _e++) {
                                    var related = relatedProvenance[_e];
                                    provenanceRemoves.push(related);
                                }
                            }
                            rowsToPostCheck.push(provenance);
                        }
                    }
                }
            }
        }
        provenanceDiff.removeFacts("provenance", provenanceRemoves);
        ixer.applyDiffIncremental(provenanceDiff);
        var isEdb = ixer.edbTables;
        for (var _f = 0; _f < rowsToPostCheck.length; _f++) {
            var row = rowsToPostCheck[_f];
            var supports = tableRowLookup[row.row.__id + '|' + row.table];
            if (!supports || supports.length === 0) {
                removes.push(row.row);
            }
        }
        return removes;
    };
    Query.prototype.canBeIncremental = function () {
        if (this.aggregates.length)
            return false;
        if (this.sorts)
            return false;
        if (this.groups)
            return false;
        if (this.limitInfo)
            return false;
        for (var _i = 0, _a = this.joins; _i < _a.length; _i++) {
            var join = _a[_i];
            if (join.negated)
                return false;
        }
        if (!this.joins.length)
            return false;
        return true;
    };
    Query.prototype.compile = function () {
        var ast = this.toAST();
        var code = this.compileAST(ast);
        this.compiled = new Function("ixer", "QueryFunctions", "tableId", "rootRows", code);
        if (this.canBeIncremental()) {
            this.incrementalRowFinder = new Function("changes", this.compileIncrementalRowFinderCode());
        }
        else {
            this.incrementalRowFinder = undefined;
        }
        this.dirty = false;
        return this;
    };
    Query.prototype.exec = function () {
        if (this.dirty) {
            this.compile();
        }
        var root = this.joins[0];
        var rows;
        if (root) {
            rows = this.ixer.find(root.table, root.join);
        }
        else {
            rows = [];
        }
        return this.compiled(this.ixer, exports.QueryFunctions, this.name, rows);
    };
    Query.prototype.execIncremental = function (changes, table) {
        if (this.dirty) {
            this.compile();
        }
        if (this.incrementalRowFinder) {
            var potentialRows = this.incrementalRowFinder(changes);
            // if the root select has some constant filters, then
            // the above rows need to be filtered down to only those that
            // match.
            var rows = [];
            var root = this.joins[0];
            var rootKeys = Object.keys(root.join);
            if (rootKeys.length > 0) {
                rowLoop: for (var _i = 0; _i < potentialRows.length; _i++) {
                    var row = potentialRows[_i];
                    for (var _a = 0; _a < rootKeys.length; _a++) {
                        var key = rootKeys[_a];
                        if (row[key] !== root.join[key])
                            continue rowLoop;
                    }
                    rows.push(row);
                }
            }
            else {
                rows = potentialRows;
            }
            var results = this.compiled(this.ixer, exports.QueryFunctions, this.name, rows);
            var adds = [];
            var prevHashes = table.factHash;
            var prevKeys = Object.keys(prevHashes);
            var suggestedRemoves = this.incrementalRemove(changes);
            var realDiff = diffAddsAndRemoves(results.results, suggestedRemoves);
            for (var _b = 0, _c = realDiff.adds; _b < _c.length; _b++) {
                var result = _c[_b];
                var id = result.__id;
                if (prevHashes[id] === undefined) {
                    adds.push(result);
                }
            }
            var diff = this.ixer.diff();
            diff.addMany("provenance", results.provenance);
            this.ixer.applyDiffIncremental(diff);
            // console.log("INC PROV DIFF", this.name, diff.length);
            return { provenance: results.provenance, adds: adds, removes: realDiff.removes };
        }
        else {
            var results = this.exec();
            var adds = [];
            var removes = [];
            var prevHashes = table.factHash;
            var prevKeys = Object.keys(prevHashes);
            var newHashes = {};
            for (var _d = 0, _e = results.results; _d < _e.length; _d++) {
                var result = _e[_d];
                var id = result.__id;
                newHashes[id] = result;
                if (prevHashes[id] === undefined) {
                    adds.push(result);
                }
            }
            for (var _f = 0; _f < prevKeys.length; _f++) {
                var hash = prevKeys[_f];
                var value = newHashes[hash];
                if (value === undefined) {
                    removes.push(prevHashes[hash]);
                }
            }
            var realDiff = diffAddsAndRemoves(adds, removes);
            var diff = this.ixer.diff();
            diff.remove("provenance", { table: this.name });
            diff.addMany("provenance", results.provenance);
            this.ixer.applyDiffIncremental(diff);
            // console.log("FULL PROV SIZE", this.name, diff.length);
            return { provenance: results.provenance, adds: realDiff.adds, removes: realDiff.removes };
        }
    };
    Query.prototype.debug = function () {
        console.log(this.compileAST(this.toAST()));
        console.time("exec");
        var results = this.exec();
        console.timeEnd("exec");
        console.log(results);
        return results;
    };
    return Query;
})();
exports.Query = Query;
var Union = (function () {
    function Union(ixer, name) {
        if (name === void 0) { name = "unknown"; }
        this.name = name;
        this.ixer = ixer;
        this.tables = [];
        this.sources = [];
        this.isStateful = false;
        this.prev = { results: [], hashes: {} };
        this.dirty = true;
    }
    Union.prototype.changeset = function (ixer) {
        var diff = ixer.diff();
        diff.add("view", { view: this.name, kind: "union" });
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            if (source.type === "+") {
                var action = utils_1.uuid();
                diff.add("action", { view: this.name, action: action, kind: "union", ix: 0 });
                diff.add("action source", { action: action, "source view": source.table });
                for (var field in source.mapping) {
                    var mapped = source.mapping[field];
                    if (mapped.constructor === Array)
                        diff.add("action mapping", { action: action, from: field, "to source": source.table, "to field": mapped[0] });
                    else
                        diff.add("action mapping constant", { action: action, from: field, value: mapped });
                }
            }
            else
                throw new Error("Unknown source type: '" + source.type + "'");
        }
        return diff;
    };
    Union.prototype.ensureHasher = function (mapping) {
        if (!this.hasher) {
            this.hasher = generateStringFn(Object.keys(mapping));
        }
    };
    Union.prototype.union = function (tableName, mapping) {
        this.dirty = true;
        this.ensureHasher(mapping);
        this.tables.push(tableName);
        this.sources.push({ type: "+", table: tableName, mapping: mapping });
        return this;
    };
    Union.prototype.toAST = function () {
        var root = { type: "union", children: [] };
        root.children.push({ type: "declaration", var: "results", value: "[]" });
        root.children.push({ type: "declaration", var: "provenance", value: "[]" });
        var hashesValue = "{}";
        if (this.isStateful) {
            hashesValue = "prevHashes";
        }
        root.children.push({ type: "declaration", var: "hashes", value: hashesValue });
        var ix = 0;
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            var action = void 0;
            if (source.type === "+") {
                action = { type: "result", ix: ix, children: [{ type: "provenance", source: source, ix: ix }] };
            }
            root.children.push({
                type: "source",
                ix: ix,
                table: source.table,
                mapping: source.mapping,
                children: [action],
            });
            ix++;
        }
        root.children.push({ type: "hashesToResults" });
        root.children.push({ type: "return", vars: ["results", "hashes", "provenance"] });
        return root;
    };
    Union.prototype.compileAST = function (root) {
        var code = "";
        var type = root.type;
        switch (type) {
            case "union":
                for (var _i = 0, _a = root.children; _i < _a.length; _i++) {
                    var child = _a[_i];
                    code += this.compileAST(child);
                }
                break;
            case "declaration":
                code += "var " + root.var + " = " + root.value + ";\n";
                break;
            case "source":
                var ix = root.ix;
                var mappingItems = [];
                for (var key in root.mapping) {
                    var mapping = root.mapping[key];
                    var value = void 0;
                    if (mapping.constructor === Array && mapping.length === 1) {
                        var field = mapping[0];
                        value = "sourceRow" + ix + "['" + field + "']";
                    }
                    else if (mapping.constructor === Array && mapping.length === 2) {
                        var _ = mapping[0], field = mapping[1];
                        value = "sourceRow" + ix + "['" + field + "']";
                    }
                    else {
                        value = JSON.stringify(mapping);
                    }
                    mappingItems.push("'" + key + "': " + value);
                }
                code += "var sourceRows" + ix + " = changes['" + root.table + "'];\n";
                code += "for(var rowIx" + ix + " = 0, rowsLen" + ix + " = sourceRows" + ix + ".length; rowIx" + ix + " < rowsLen" + ix + "; rowIx" + ix + "++) {\n";
                code += "var sourceRow" + ix + " = sourceRows" + ix + "[rowIx" + ix + "];\n";
                code += "var mappedRow" + ix + " = {" + mappingItems.join(", ") + "};\n";
                for (var _b = 0, _c = root.children; _b < _c.length; _b++) {
                    var child = _c[_b];
                    code += this.compileAST(child);
                }
                code += "}\n";
                break;
            case "result":
                var ix = root.ix;
                code += "var hash" + ix + " = hasher(mappedRow" + ix + ");\n";
                code += "mappedRow" + ix + ".__id = hash" + ix + ";\n";
                code += "hashes[hash" + ix + "] = mappedRow" + ix + ";\n";
                for (var _d = 0, _e = root.children; _d < _e.length; _d++) {
                    var child = _e[_d];
                    code += this.compileAST(child);
                }
                break;
            case "removeResult":
                var ix = root.ix;
                code += "hashes[hasher(mappedRow" + ix + ")] = false;\n";
                break;
            case "hashesToResults":
                code += "var hashKeys = Object.keys(hashes);\n";
                code += "for(var hashKeyIx = 0, hashKeyLen = hashKeys.length; hashKeyIx < hashKeyLen; hashKeyIx++) {\n";
                code += "var curHashKey = hashKeys[hashKeyIx];";
                code += "var value = hashes[curHashKey];\n";
                code += "if(value !== false) {\n";
                code += "value.__id = curHashKey;\n";
                code += "results.push(value);\n";
                code += "}\n";
                code += "}\n";
                break;
            case "provenance":
                var source = root.source.table;
                var ix = root.ix;
                var provenance = "var provenance__id = '';\n";
                provenance += "provenance__id = '" + this.name + "|' + mappedRow" + ix + ".__id + '|' + rowInstance + '|" + source + "|' + sourceRow" + ix + ".__id; \n";
                provenance += "provenance.push({table: '" + this.name + "', row: mappedRow" + ix + ", \"row instance\": rowInstance, source: \"" + source + "\", \"source row\": sourceRow" + ix + "});\n";
                code = "var rowInstance = \"" + source + "|\" + mappedRow" + ix + ".__id;\n        " + provenance;
                break;
            case "return":
                code += "return {" + root.vars.map(function (name) { return (name + ": " + name); }).join(", ") + "};";
                break;
        }
        return code;
    };
    Union.prototype.compile = function () {
        var ast = this.toAST();
        var code = this.compileAST(ast);
        this.compiled = new Function("ixer", "hasher", "changes", code);
        this.dirty = false;
        return this;
    };
    Union.prototype.debug = function () {
        var code = this.compileAST(this.toAST());
        console.log(code);
        return code;
    };
    Union.prototype.exec = function () {
        if (this.dirty) {
            this.compile();
        }
        var changes = {};
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            changes[source.table] = this.ixer.table(source.table).table;
        }
        var results = this.compiled(this.ixer, this.hasher, changes);
        return results;
    };
    Union.prototype.incrementalRemove = function (changes) {
        var ixer = this.ixer;
        var rowsToPostCheck = [];
        var provenanceDiff = this.ixer.diff();
        var removes = [];
        var indexes = ixer.table("provenance").indexes;
        var sourceRowLookup = indexes["source|source row|table"].index;
        var rowInstanceLookup = indexes["row instance|table"].index;
        var tableRowLookup = indexes["row|table"].index;
        var provenanceRemoves = [];
        var visited = {};
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            var change = changes[source.table];
            if (!visited[source.table] && change && change.removes.length) {
                visited[source.table] = true;
                for (var _b = 0, _c = change.removes; _b < _c.length; _b++) {
                    var remove = _c[_b];
                    var provenances = sourceRowLookup[source.table + '|' + remove.__id + '|' + this.name];
                    if (provenances) {
                        for (var _d = 0; _d < provenances.length; _d++) {
                            var provenance = provenances[_d];
                            if (!visited[provenance["row instance"]]) {
                                visited[provenance["row instance"]] = true;
                                var relatedProvenance = rowInstanceLookup[provenance["row instance"] + '|' + provenance.table];
                                for (var _e = 0; _e < relatedProvenance.length; _e++) {
                                    var related = relatedProvenance[_e];
                                    provenanceRemoves.push(related);
                                }
                            }
                            rowsToPostCheck.push(provenance);
                        }
                    }
                }
            }
        }
        provenanceDiff.removeFacts("provenance", provenanceRemoves);
        ixer.applyDiffIncremental(provenanceDiff);
        var isEdb = ixer.edbTables;
        for (var _f = 0; _f < rowsToPostCheck.length; _f++) {
            var row = rowsToPostCheck[_f];
            var supports = tableRowLookup[row.row.__id + '|' + row.table];
            if (!supports || supports.length === 0) {
                removes.push(row.row);
            }
            else if (this.sources.length > 2) {
                var supportsToRemove = [];
                // otherwise if there are supports, then we need to walk the support
                // graph backwards and make sure every supporting row terminates at an
                // edb value. If not, then that support also needs to be removed
                for (var _g = 0; _g < supports.length; _g++) {
                    var support = supports[_g];
                    // if the support is already an edb, we're good to go.
                    if (isEdb[support.source])
                        continue;
                    if (!tableRowLookup[support["source row"].__id + '|' + support.source]) {
                        supportsToRemove.push(support);
                        continue;
                    }
                    // get all the supports for this support
                    var nodes = tableRowLookup[support["source row"].__id + '|' + support.source].slice();
                    var nodeIx = 0;
                    // iterate through all the nodes, if they have further supports then
                    // assume this node is ok and add those supports to the list of nodes to
                    // check. If we run into a node with no supports it must either be an edb
                    // or it's unsupported and this row instance needs to be removed.
                    while (nodeIx < nodes.length) {
                        var node = nodes[nodeIx];
                        if (isEdb[node.source]) {
                            nodeIx++;
                            continue;
                        }
                        var nodeSupports = tableRowLookup[node["source row"].__id + '|' + node.source];
                        if (!nodeSupports || nodeSupports.length === 0) {
                            supportsToRemove.push(support);
                            break;
                        }
                        else {
                            for (var _h = 0; _h < nodeSupports.length; _h++) {
                                var nodeSupport = nodeSupports[_h];
                                nodes.push(nodeSupport);
                            }
                            nodeIx++;
                        }
                    }
                }
                if (supportsToRemove.length) {
                    // we need to remove all the supports
                    var provenanceRemoves_1 = [];
                    for (var _j = 0; _j < supportsToRemove.length; _j++) {
                        var support = supportsToRemove[_j];
                        var relatedProvenance = rowInstanceLookup[support["row instance"] + '|' + support.table];
                        for (var _k = 0; _k < relatedProvenance.length; _k++) {
                            var related = relatedProvenance[_k];
                            provenanceRemoves_1.push(related);
                        }
                    }
                    var diff = ixer.diff();
                    diff.removeFacts("provenance", provenanceRemoves_1);
                    ixer.applyDiffIncremental(diff);
                    // now that all the unsupported provenances have been removed, check if there's anything
                    // left.
                    if (!tableRowLookup[row.row.__id + '|' + row.table] || tableRowLookup[row.row.__id + '|' + row.table].length === 0) {
                        removes.push(row.row);
                    }
                }
            }
        }
        return removes;
    };
    Union.prototype.execIncremental = function (changes, table) {
        if (this.dirty) {
            this.compile();
        }
        var sourceChanges = {};
        for (var _i = 0, _a = this.sources; _i < _a.length; _i++) {
            var source = _a[_i];
            var value = void 0;
            if (!changes[source.table]) {
                value = [];
            }
            else {
                value = changes[source.table].adds;
            }
            sourceChanges[source.table] = value;
        }
        var results = this.compiled(this.ixer, this.hasher, sourceChanges);
        var adds = [];
        var prevHashes = table.factHash;
        var prevKeys = Object.keys(prevHashes);
        var suggestedRemoves = this.incrementalRemove(changes);
        var realDiff = diffAddsAndRemoves(results.results, suggestedRemoves);
        for (var _b = 0, _c = realDiff.adds; _b < _c.length; _b++) {
            var result = _c[_b];
            var id = result.__id;
            if (prevHashes[id] === undefined) {
                adds.push(result);
            }
        }
        var diff = this.ixer.diff();
        diff.addMany("provenance", results.provenance);
        this.ixer.applyDiffIncremental(diff);
        return { provenance: results.provenance, adds: adds, removes: realDiff.removes };
    };
    return Union;
})();
exports.Union = Union;
//---------------------------------------------------------
// Builtin Primitives
//---------------------------------------------------------
runtime.define("count", { result: "count" }, function (prev) {
    if (!prev.count) {
        prev.count = 0;
    }
    prev.count++;
    return prev;
});
runtime.define("sum", { result: "sum" }, function (prev, value) {
    if (!prev.sum) {
        prev.sum = 0;
    }
    prev.sum += value;
    return prev;
});
runtime.define("average", { result: "average" }, function (prev, value) {
    if (!prev.sum) {
        prev.sum = 0;
        prev.count = 0;
    }
    prev.count++;
    prev.sum += value;
    prev.average = prev.sum / prev.count;
    return prev;
});
runtime.define("lowercase", { result: "lowercase" }, function (text) {
    if (typeof text === "string") {
        return { result: text.toLowerCase() };
    }
    return { result: text };
});
runtime.define("=", { filter: true }, function (a, b) {
    return a === b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define(">", { filter: true }, function (a, b) {
    return a > b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("<", { filter: true }, function (a, b) {
    return a < b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define(">=", { filter: true }, function (a, b) {
    return a >= b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("<=", { filter: true }, function (a, b) {
    return a <= b ? runtime.SUCCEED : runtime.FAIL;
});
runtime.define("+", { result: "result" }, function (a, b) {
    return { result: a + b };
});
runtime.define("-", { result: "result" }, function (a, b) {
    return { result: a - b };
});
runtime.define("*", { result: "result" }, function (a, b) {
    return { result: a * b };
});
runtime.define("/", { result: "result" }, function (a, b) {
    return { result: a / b };
});
//---------------------------------------------------------
// Public API
//---------------------------------------------------------
exports.SUCCEED = [{ success: true }];
exports.FAIL = [];
function indexer() {
    return addProvenanceTable(new Indexer());
}
exports.indexer = indexer;
if (utils_1.ENV === "browser")
    window["runtime"] = exports;

},{"./utils":12}],9:[function(require,module,exports){
var app = require("./app");
var app_1 = require("./app");
var wiki = require("./wiki");
var queryParser_1 = require("./queryParser");
var newSearch = queryParser_1.queryToExecutable;
var newSearchResults = wiki.newSearchResults;
function randomlyLetter(phrase, klass) {
    if (klass === void 0) { klass = ""; }
    var children = [];
    var ix = 0;
    for (var _i = 0; _i < phrase.length; _i++) {
        var letter = phrase[_i];
        var rand = Math.round(Math.random() * 5);
        children.push({ id: phrase + ix, t: "span", c: "letter", text: letter, enter: { opacity: 1, duration: (rand * 100) + 150, delay: (0 * 30) + 300 }, leave: { opacity: 0, duration: 250 } });
        ix++;
    }
    return { c: "phrase " + klass, children: children };
}
var slideNumber = 0;
var slides = [
    { type: "slide",
        content: { children: [
                randomlyLetter("The world is full of bits of information.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("We spend our lives exploring those bits.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("They form the foundation of our understanding, our decisions, our work...")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("And yet the tools we have to work with them are fairly primitive.")
            ] } },
    { type: "slide",
        content: { children: [
                { id: "slide-list", c: "list", children: [
                        randomlyLetter("- Our communications are static"),
                        randomlyLetter("- Information requires rigid structure"),
                        randomlyLetter("- Exploration is either limited or it's code"),
                    ] }
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("That's where I come in.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("I help collect, explore, and communicate aspects of the world around you.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("My name is Eve.")
            ] } },
    { type: "slide",
        setup: function () {
            var diff = app_1.eve.diff();
            diff.add("search", { id: "edward norton", top: 0, left: 0 });
            diff.add("search query", { id: "edward norton", search: "edward norton" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["edward norton"] = newSearch("edward norton");
        },
        teardown: function () {
            var diff = app_1.eve.diff();
            diff.remove("search", { id: "edward norton" });
            diff.remove("search query", { id: "edward norton" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["edward norton"] = null;
        },
        content: function () {
            var search = newSearchResults("edward norton");
            search.leave = { opacity: 0, duration: 300 },
                search.enter = { opacity: 1, duration: 2500, delay: 300, begin: function (node) {
                        if (!node[0])
                            return;
                        setTimeout(function () {
                            node[0].querySelector(".search-box").editor.refresh();
                        }, 30);
                    } };
            return { children: [
                    randomlyLetter("And I collect bits like this one"),
                    search,
                ] };
        }
    },
    { type: "slide",
        content: { children: [
                randomlyLetter("A bit is kind of like a page in a wiki.")
            ] } },
    { type: "slide",
        content: { children: [
                { id: "slide-list", c: "list", children: [
                        randomlyLetter("- You can capture information however it comes."),
                        randomlyLetter("- No planning or pre-structuring is required"),
                        randomlyLetter("- Nothing is too big or too small for a bit"),
                        randomlyLetter("- Instead of just rows in tables, you can collect the whole story"),
                    ] }
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("All of which is important when importing information from the outside world.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("And I was designed to be as malleable as possible to accomodate that.")
            ] } },
    { type: "slide",
        content: { children: [
                { id: "slide-list", c: "list", children: [
                        randomlyLetter("- You can add structure at any time"),
                        randomlyLetter("- Work with heterogenous collections"),
                        randomlyLetter("- Handle one off tasks and deal with special cases"),
                    ] }
            ] } },
    // {type: "eve"},
    { type: "slide",
        content: { children: [
                randomlyLetter("But that malleability doesn't sacrifice the ability to explore.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("You can navigate through the web of bits you collect and ask complex questions to discover new information.")
            ] } },
    { type: "slide",
        setup: function () {
            var diff = app_1.eve.diff();
            diff.add("search", { id: "episodes", top: 0, left: 0 });
            diff.add("search query", { id: "episodes", search: "modern family" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = newSearch("modern family");
        },
        teardown: function () {
            var diff = app_1.eve.diff();
            diff.remove("search", { id: "episodes" });
            diff.remove("search query", { id: "episodes" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = null;
        },
        content: function () {
            var search = newSearchResults("episodes");
            search.leave = { opacity: 0, duration: 300 },
                search.enter = { opacity: 1, duration: 1000, delay: 300, begin: function (node) {
                        if (!node[0])
                            return;
                        setTimeout(function () {
                            node[0].querySelector(".search-box").editor.refresh();
                        }, 30);
                    } };
            return { children: [
                    { c: "row", children: [
                            { c: "phrase-container", children: [
                                    randomlyLetter("For example, here's a bit about Modern Family"),
                                ] },
                            search,
                        ] }
                ] };
        }
    },
    { type: "slide",
        setup: function () {
            var diff = app_1.eve.diff();
            diff.add("search", { id: "episodes", top: 0, left: 0 });
            diff.add("search query", { id: "episodes", search: "episodes of modern family" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = newSearch("episodes of modern family");
        },
        teardown: function () {
            var diff = app_1.eve.diff();
            diff.remove("search", { id: "episodes" });
            diff.remove("search query", { id: "episodes" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = null;
        },
        content: function () {
            var search = newSearchResults("episodes");
            search.leave = { opacity: 0, duration: 300 };
            return { children: [
                    { c: "row", children: [
                            { c: "phrase-container", children: [
                                    randomlyLetter("We can ask what episodes we know about for Modern Family"),
                                ] },
                            search,
                        ] }
                ] };
        }
    },
    { type: "slide",
        setup: function () {
            var diff = app_1.eve.diff();
            diff.add("search", { id: "episodes", top: 0, left: 0 });
            diff.add("search query", { id: "episodes", search: "episodes of modern family with edward norton" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = newSearch("episodes of modern family with edward norton");
        },
        teardown: function () {
            var diff = app_1.eve.diff();
            diff.remove("search", { id: "episodes" });
            diff.remove("search query", { id: "episodes" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = null;
        },
        content: function () {
            var search = newSearchResults("episodes");
            search.leave = { opacity: 0, duration: 300 };
            return { children: [
                    { c: "row", children: [
                            { c: "phrase-container", children: [
                                    randomlyLetter("And get just the ones that have Edward Norton in them"),
                                ] },
                            search,
                        ] }
                ] };
        }
    },
    { type: "slide",
        setup: function () {
            var diff = app_1.eve.diff();
            diff.add("search", { id: "episodes", top: 0, left: 0 });
            diff.add("search query", { id: "episodes", search: "count the episodes of modern family without edward norton" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = newSearch("count the episodes of modern family without edward norton");
        },
        teardown: function () {
            var diff = app_1.eve.diff();
            diff.remove("search", { id: "episodes" });
            diff.remove("search query", { id: "episodes" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = null;
        },
        content: function () {
            var search = newSearchResults("episodes");
            search.leave = { opacity: 0, duration: 300 };
            return { children: [
                    { c: "row", children: [
                            { c: "phrase-container", children: [
                                    randomlyLetter("Or let's count the number of episodes that don't have Norton in them."),
                                ] },
                            search,
                        ] }
                ] };
        }
    },
    { type: "slide",
        content: { children: [
                randomlyLetter("As you can see, my search is pretty powerful. It also has some important properties.")
            ] } },
    { type: "slide",
        content: { children: [
                { id: "slide-list", c: "list", children: [
                        randomlyLetter("- It's live: you never have to refresh"),
                        randomlyLetter("- It's tangible: you can see how I got the result"),
                        randomlyLetter("- It's manipulable: you can take the results and do more with them"),
                    ] }
            ] } },
    { type: "slide",
        setup: function () {
            var diff = app_1.eve.diff();
            diff.add("search", { id: "episodes", top: 0, left: 0 });
            diff.add("search query", { id: "episodes", search: "sum of salaries per department" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = newSearch("sum of salaries per department");
        },
        teardown: function () {
            var diff = app_1.eve.diff();
            diff.remove("search", { id: "episodes" });
            diff.remove("search query", { id: "episodes" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = null;
        },
        content: function () {
            var search = newSearchResults("episodes");
            search.leave = { opacity: 0, duration: 300 };
            return { children: [
                    { c: "row", children: [
                            { c: "phrase-container", children: [
                                    randomlyLetter("Here we have the sum of all the salaries per department, which we store as the 'total cost' per department."),
                                ] },
                            search,
                        ] }
                ] };
        }
    },
    { type: "slide",
        setup: function () {
            var diff = app_1.eve.diff();
            diff.add("search", { id: "episodes", top: 0, left: 0 });
            diff.add("search query", { id: "episodes", search: "engineering" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = newSearch("engineering");
        },
        teardown: function () {
            var diff = app_1.eve.diff();
            diff.remove("search", { id: "episodes" });
            diff.remove("search query", { id: "episodes" });
            app_1.eve.applyDiff(diff);
            app.activeSearches["episodes"] = null;
        },
        content: function () {
            var search = newSearchResults("episodes");
            search.leave = { opacity: 0, duration: 300 };
            return { children: [
                    { c: "row", children: [
                            { c: "phrase-container", children: [
                                    randomlyLetter("So now you see that engineering has a total cost."),
                                ] },
                            search,
                        ] }
                ] };
        }
    },
    // {type: "eve"},
    // {type: "slide",
    //  content: {children: [
    //    randomlyLetter("You can also peer into the past and explore alternative futures.")
    //  ]}},
    { type: "slide",
        content: { children: [
                randomlyLetter("Through this, I reduce much of programming to searching and formatting the results.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("But that is usually just the first step towards a more important goal: communicating.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("Fortunately, you can send bits to other people and systems.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("You can also create documents, dashboards, even custom interfaces, by drawing and embedding bits.")
            ] } },
    // {type: "eve"},
    { type: "slide",
        content: { children: [
                randomlyLetter("And since what's being sent is itself a bit, others can pull it apart to see how it was made.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("They can remix it and create new bits based on the information.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("This enables people to collaborate in a much deeper way.")
            ] } },
    // {type: "slide",
    //  content: {children: [
    //    randomlyLetter("And one thing I've learned about that collaboration is that it doesn't always mean consensus.")
    //  ]}},
    { type: "slide",
        content: { children: [
                randomlyLetter("Many versions of a bit can exist; you can have yours and others can have theirs.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("But changes can be proposed, approved, and discarded to create a final version.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("This allows people to contribute to the overall process, while maintaining control of the end result.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("It also allows for different world views and ideas of correctness, which is vital to fitting into the real world.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("Instead of pretending like everything will fit neatly into a box...")
            ] } },
    // {type: "slide",
    //  content: {children: [
    //    randomlyLetter("The world is changing and we all have different views into it.")
    //  ]}},
    // {type: "slide",
    //  content: {children: [
    //    {id: "slide-list", c: "list", children: [
    //       randomlyLetter("There's a new version of work: everything revolves around constantly changing data"),
    //       randomlyLetter("New platforms: mobile, voice, pen, VR, AR"),
    //       randomlyLetter("New kinds of systems: everything is distributed"),
    //    ]}
    //  ]}},
    { type: "slide",
        content: { children: [
                randomlyLetter("I am designed to collect, explore, and communicate in a world that is constantly changing.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("I am alive, malleable, and always available.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("I am honest, genuine, curious, and conversational.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("I am Eve.")
            ] } },
    { type: "slide",
        content: { children: [
                randomlyLetter("It's nice to meet you.")
            ] } },
];
function nextSlide(e, elem) {
    var prev = slides[slideNumber];
    if (prev.teardown) {
        prev.teardown();
    }
    if (!elem.back) {
        slideNumber++;
    }
    else {
        slideNumber--;
    }
    if (slideNumber < 0)
        slideNumber = 0;
    if (slideNumber >= slides.length)
        slideNumber = slides.length - 1;
    var slide = slides[slideNumber];
    if (slide.setup) {
        slide.setup();
    }
    e.stopPropagation();
    e.preventDefault();
    console.log(slideNumber);
    app.render();
}
function slideControls() {
    return { c: "slide-controls", children: [
            { c: "ion-ios-arrow-back", back: true, click: nextSlide },
            { c: "ion-ios-arrow-forward", click: nextSlide }
        ] };
}
function root() {
    var slide = slides[slideNumber] || { type: "slide" };
    if (slide.type === "slide") {
        var content = slide.content;
        if (typeof content === "function") {
            content = content();
        }
        return { id: "root", c: "root slide", children: [
                slideControls(),
                content
            ] };
    }
    else {
        var root = wiki.eveRoot();
        root.children.unshift(slideControls());
        return root;
    }
}
exports.root = root;
app.renderRoots["wiki"] = root;
localStorage["local-eve"] = JSON.stringify({ "view": [{ "view": "generated eav", "kind": "union", "__id": "generated eav|union" }, { "view": "manual entity", "kind": "table", "__id": "manual entity|table" }, { "view": "manual eav", "kind": "table", "__id": "manual eav|table" }, { "view": "action entity", "kind": "table", "__id": "action entity|table" }, { "view": "entity", "kind": "query", "__id": "entity|query" }, { "view": "unmodified added bits", "kind": "query", "__id": "unmodified added bits|query" }, { "view": "content blocks", "kind": "query", "__id": "content blocks|query" }, { "view": "parsed content blocks", "kind": "query", "__id": "parsed content blocks|query" }, { "view": "parsed eavs", "kind": "query", "__id": "parsed eavs|query" }, { "view": "entity eavs", "kind": "union", "__id": "entity eavs|union" }, { "view": "builtin entity eavs", "kind": "table", "__id": "builtin entity eavs|table" }, { "view": "is a attributes", "kind": "query", "__id": "is a attributes|query" }, { "view": "lowercase eavs", "kind": "query", "__id": "lowercase eavs|query" }, { "view": "eav entity links", "kind": "query", "__id": "eav entity links|query" }, { "view": "entity links", "kind": "union", "__id": "entity links|union" }, { "view": "builtin entity links", "kind": "table", "__id": "builtin entity links|table" }, { "view": "directionless links", "kind": "union", "__id": "directionless links|union" }, { "view": "builtin directionless links", "kind": "table", "__id": "builtin directionless links|table" }, { "view": "collection entities", "kind": "union", "__id": "collection entities|union" }, { "view": "builtin collection entities", "kind": "table", "__id": "builtin collection entities|table" }, { "view": "collection", "kind": "query", "__id": "collection|query" }, { "view": "search", "kind": "union", "__id": "search|union" }, { "view": "builtin search", "kind": "table", "__id": "builtin search|table" }, { "view": "search query", "kind": "union", "__id": "search query|union" }, { "view": "builtin search query", "kind": "table", "__id": "builtin search query|table" }, { "view": "searches to entities shim", "kind": "query", "__id": "searches to entities shim|query" }, { "view": "ui template", "kind": "table", "__id": "ui template|table" }, { "view": "ui template binding", "kind": "table", "__id": "ui template binding|table" }, { "view": "ui embed", "kind": "table", "__id": "ui embed|table" }, { "view": "ui embed scope", "kind": "table", "__id": "ui embed scope|table" }, { "view": "ui embed scope binding", "kind": "table", "__id": "ui embed scope binding|table" }, { "view": "ui attribute", "kind": "table", "__id": "ui attribute|table" }, { "view": "ui attribute binding", "kind": "table", "__id": "ui attribute binding|table" }, { "view": "ui event", "kind": "table", "__id": "ui event|table" }, { "view": "ui event state", "kind": "table", "__id": "ui event state|table" }, { "view": "ui event state binding", "kind": "table", "__id": "ui event state binding|table" }, { "view": "system ui", "kind": "table", "__id": "system ui|table" }, { "view": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2", "kind": "query", "__id": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2|query" }, { "view": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a", "kind": "query", "__id": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a|query" }, { "view": "employees", "kind": "query", "__id": "employees|query" }, { "view": "sum of salaries per department", "kind": "query", "__id": "sum of salaries per department|query" }, { "view": "sum of salaries per department|bit", "kind": "query", "__id": "sum of salaries per department|bit|query" }], "action": [{ "view": "unmodified added bits", "action": "1e5e0210-d109-4b8f-91cb-e14a422e11da", "kind": "deselect", "ix": 1000, "__id": "unmodified added bits|1e5e0210-d109-4b8f-91cb-e14a422e11da|deselect|1000" }, { "view": "unmodified added bits", "action": "97f2afde-c0cd-41cb-98ec-51f268feb47c", "kind": "select", "ix": 0, "__id": "unmodified added bits|97f2afde-c0cd-41cb-98ec-51f268feb47c|select|0" }, { "view": "entity", "action": "230901a0-a9eb-480d-b8bd-152a27bba9d6", "kind": "project", "ix": 9007199254740991, "__id": "entity|230901a0-a9eb-480d-b8bd-152a27bba9d6|project|9007199254740991" }, { "view": "entity", "action": "b02e0ae8-90a7-4e76-a6d4-9a9b5bdcaf18", "kind": "select", "ix": 0, "__id": "entity|b02e0ae8-90a7-4e76-a6d4-9a9b5bdcaf18|select|0" }, { "view": "content blocks", "action": "5bec8cc7-7c55-4a21-b055-728ee9202d6a", "kind": "select", "ix": 1, "__id": "content blocks|5bec8cc7-7c55-4a21-b055-728ee9202d6a|select|1" }, { "view": "content blocks", "action": "79451f35-89a2-4671-a1e1-d1ae785c1663", "kind": "select", "ix": 0, "__id": "content blocks|79451f35-89a2-4671-a1e1-d1ae785c1663|select|0" }, { "view": "unmodified added bits", "action": "0b8ce76d-9bba-409f-9208-bc0b260d989e", "kind": "project", "ix": 9007199254740991, "__id": "unmodified added bits|0b8ce76d-9bba-409f-9208-bc0b260d989e|project|9007199254740991" }, { "view": "parsed content blocks", "action": "10e5f68c-865d-4edf-ad3d-4b6e379ca923", "kind": "select", "ix": 0, "__id": "parsed content blocks|10e5f68c-865d-4edf-ad3d-4b6e379ca923|select|0" }, { "view": "content blocks", "action": "b4035b12-6251-45dd-8983-325bd9164a18", "kind": "project", "ix": 9007199254740991, "__id": "content blocks|b4035b12-6251-45dd-8983-325bd9164a18|project|9007199254740991" }, { "view": "content blocks", "action": "9fbf8614-c71a-4a92-b757-71542af9f056", "kind": "select", "ix": 2, "__id": "content blocks|9fbf8614-c71a-4a92-b757-71542af9f056|select|2" }, { "view": "parsed content blocks", "action": "e9f0d3d0-e035-409c-86a0-93119a6f34ea", "kind": "project", "ix": 9007199254740991, "__id": "parsed content blocks|e9f0d3d0-e035-409c-86a0-93119a6f34ea|project|9007199254740991" }, { "view": "parsed content blocks", "action": "1125f6a6-181c-430b-811a-39f20299a8ad", "kind": "calculate", "ix": 1, "__id": "parsed content blocks|1125f6a6-181c-430b-811a-39f20299a8ad|calculate|1" }, { "view": "parsed eavs", "action": "d183591e-f1fb-448e-b430-d1f37393e810", "kind": "project", "ix": 9007199254740991, "__id": "parsed eavs|d183591e-f1fb-448e-b430-d1f37393e810|project|9007199254740991" }, { "view": "parsed eavs", "action": "d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6", "kind": "calculate", "ix": 1, "__id": "parsed eavs|d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6|calculate|1" }, { "view": "parsed eavs", "action": "b23dc854-3fec-4757-a478-d5388840acc1", "kind": "select", "ix": 0, "__id": "parsed eavs|b23dc854-3fec-4757-a478-d5388840acc1|select|0" }, { "view": "entity eavs", "action": "entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "kind": "union", "ix": 0, "__id": "entity eavs|entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|union|0" }, { "view": "entity eavs", "action": "entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "kind": "union", "ix": 0, "__id": "entity eavs|entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|union|0" }, { "view": "entity eavs", "action": "entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "kind": "union", "ix": 0, "__id": "entity eavs|entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|union|0" }, { "view": "entity eavs", "action": "entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "kind": "union", "ix": 0, "__id": "entity eavs|entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|union|0" }, { "view": "entity eavs", "action": "entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "kind": "union", "ix": 0, "__id": "entity eavs|entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|union|0" }, { "view": "entity eavs", "action": "entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "kind": "union", "ix": 0, "__id": "entity eavs|entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|union|0" }, { "view": "lowercase eavs", "action": "a576196d-84d5-43e6-9116-edf96b152a71", "kind": "select", "ix": 0, "__id": "lowercase eavs|a576196d-84d5-43e6-9116-edf96b152a71|select|0" }, { "view": "is a attributes", "action": "9fac0c63-a68a-43ec-b69f-09f29c15ddb6", "kind": "project", "ix": 9007199254740991, "__id": "is a attributes|9fac0c63-a68a-43ec-b69f-09f29c15ddb6|project|9007199254740991" }, { "view": "is a attributes", "action": "7de9fcc7-fc5b-4604-92fe-b9654589b84c", "kind": "select", "ix": 0, "__id": "is a attributes|7de9fcc7-fc5b-4604-92fe-b9654589b84c|select|0" }, { "view": "eav entity links", "action": "eec9f039-08e6-46ba-b04b-84d9735808c2", "kind": "select", "ix": 1, "__id": "eav entity links|eec9f039-08e6-46ba-b04b-84d9735808c2|select|1" }, { "view": "eav entity links", "action": "5ff8a466-5a5c-46f2-850d-d0f5265b18c2", "kind": "select", "ix": 0, "__id": "eav entity links|5ff8a466-5a5c-46f2-850d-d0f5265b18c2|select|0" }, { "view": "lowercase eavs", "action": "228de452-b96e-4008-bec9-0ef023c351fc", "kind": "project", "ix": 9007199254740991, "__id": "lowercase eavs|228de452-b96e-4008-bec9-0ef023c351fc|project|9007199254740991" }, { "view": "lowercase eavs", "action": "5605ce60-5b9c-460b-9554-f67f10bfe842", "kind": "calculate", "ix": 1, "__id": "lowercase eavs|5605ce60-5b9c-460b-9554-f67f10bfe842|calculate|1" }, { "view": "collection", "action": "0c002f76-4ef9-48c6-8421-33084657a3ae", "kind": "aggregate", "ix": 1, "__id": "collection|0c002f76-4ef9-48c6-8421-33084657a3ae|aggregate|1" }, { "view": "entity links", "action": "entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "kind": "union", "ix": 0, "__id": "entity links|entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|union|0" }, { "view": "entity links", "action": "entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "kind": "union", "ix": 0, "__id": "entity links|entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|union|0" }, { "view": "entity links", "action": "entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}", "kind": "union", "ix": 0, "__id": "entity links|entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}|union|0" }, { "view": "directionless links", "action": "directionless links <-- builtin directionless links <-- {\"entity\":\"entity\",\"link\":\"link\"}", "kind": "union", "ix": 0, "__id": "directionless links|directionless links <-- builtin directionless links <-- {\"entity\":\"entity\",\"link\":\"link\"}|union|0" }, { "view": "directionless links", "action": "directionless links <-- entity links <-- {\"entity\":\"entity\",\"link\":\"link\"}", "kind": "union", "ix": 0, "__id": "directionless links|directionless links <-- entity links <-- {\"entity\":\"entity\",\"link\":\"link\"}|union|0" }, { "view": "directionless links", "action": "directionless links <-- entity links <-- {\"entity\":\"link\",\"link\":\"entity\"}", "kind": "union", "ix": 0, "__id": "directionless links|directionless links <-- entity links <-- {\"entity\":\"link\",\"link\":\"entity\"}|union|0" }, { "view": "collection entities", "action": "collection entities <-- builtin collection entities <-- {\"entity\":\"entity\",\"collection\":\"collection\"}", "kind": "union", "ix": 0, "__id": "collection entities|collection entities <-- builtin collection entities <-- {\"entity\":\"entity\",\"collection\":\"collection\"}|union|0" }, { "view": "collection entities", "action": "collection entities <-- is a attributes <-- {\"entity\":\"entity\",\"collection\":\"collection\"}", "kind": "union", "ix": 0, "__id": "collection entities|collection entities <-- is a attributes <-- {\"entity\":\"entity\",\"collection\":\"collection\"}|union|0" }, { "view": "collection", "action": "64c8ae4c-cded-478d-9f4a-7ad1dc5c7185", "kind": "select", "ix": 0, "__id": "collection|64c8ae4c-cded-478d-9f4a-7ad1dc5c7185|select|0" }, { "view": "eav entity links", "action": "952147cb-02c8-43f7-833b-76cdcea3e6d0", "kind": "project", "ix": 9007199254740991, "__id": "eav entity links|952147cb-02c8-43f7-833b-76cdcea3e6d0|project|9007199254740991" }, { "view": "collection", "action": "ade245fa-ff66-456b-b52e-400817180c29", "kind": "project", "ix": 9007199254740991, "__id": "collection|ade245fa-ff66-456b-b52e-400817180c29|project|9007199254740991" }, { "view": "collection", "action": "563e4b9e-8122-45b6-93da-325b4135a10d", "kind": "group", "ix": 9007199254740991, "__id": "collection|563e4b9e-8122-45b6-93da-325b4135a10d|group|9007199254740991" }, { "view": "search", "action": "search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}", "kind": "union", "ix": 0, "__id": "search|search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}|union|0" }, { "view": "search query", "action": "search query <-- builtin search query <-- {\"id\":\"id\",\"search\":\"search\"}", "kind": "union", "ix": 0, "__id": "search query|search query <-- builtin search query <-- {\"id\":\"id\",\"search\":\"search\"}|union|0" }, { "view": "searches to entities shim", "action": "3f28818f-6e0c-4352-af3c-b909993e6fce", "kind": "project", "ix": 9007199254740991, "__id": "searches to entities shim|3f28818f-6e0c-4352-af3c-b909993e6fce|project|9007199254740991" }, { "view": "searches to entities shim", "action": "2db00496-2eff-4d2a-b487-4c3705805c3e", "kind": "select", "ix": 1, "__id": "searches to entities shim|2db00496-2eff-4d2a-b487-4c3705805c3e|select|1" }, { "view": "searches to entities shim", "action": "1df78edc-b7df-452b-a73c-e2d5939ec8b9", "kind": "select", "ix": 0, "__id": "searches to entities shim|1df78edc-b7df-452b-a73c-e2d5939ec8b9|select|0" }, { "view": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2", "action": "b844cb2b-7503-4346-b32d-d86191765a8f", "kind": "select", "ix": 0, "__id": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2|b844cb2b-7503-4346-b32d-d86191765a8f|select|0" }, { "view": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2", "action": "a854f706-a256-48ec-9d90-0eb297a50d06", "kind": "project", "ix": 9007199254740991, "__id": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2|a854f706-a256-48ec-9d90-0eb297a50d06|project|9007199254740991" }, { "view": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2", "action": "9b37c2cd-5628-4d5e-8a69-916ca66cac87", "kind": "select", "ix": 4, "__id": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2|9b37c2cd-5628-4d5e-8a69-916ca66cac87|select|4" }, { "view": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2", "action": "0d27fe25-b05e-44b9-9e45-af96a23bacbf", "kind": "select", "ix": 3, "__id": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2|0d27fe25-b05e-44b9-9e45-af96a23bacbf|select|3" }, { "view": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2", "action": "31405d57-a5fb-44b0-ad91-a33da4edcaca", "kind": "select", "ix": 2, "__id": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2|31405d57-a5fb-44b0-ad91-a33da4edcaca|select|2" }, { "view": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2", "action": "be9d0f9b-609a-4025-9568-c1e5dff96bc6", "kind": "select", "ix": 1, "__id": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2|be9d0f9b-609a-4025-9568-c1e5dff96bc6|select|1" }, { "view": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a", "action": "9b46fcb4-ae02-4b8e-b23c-d462c2c519b0", "kind": "project", "ix": 9007199254740991, "__id": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a|9b46fcb4-ae02-4b8e-b23c-d462c2c519b0|project|9007199254740991" }, { "view": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a", "action": "b6943987-ea3e-4a9b-b011-ba7bc269a2ae", "kind": "select", "ix": 3, "__id": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a|b6943987-ea3e-4a9b-b011-ba7bc269a2ae|select|3" }, { "view": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a", "action": "0a3d741e-dbd7-4e70-98a9-10a14f5b02e2", "kind": "select", "ix": 2, "__id": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a|0a3d741e-dbd7-4e70-98a9-10a14f5b02e2|select|2" }, { "view": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a", "action": "dc275676-ad80-4db1-b3ef-9bfb1f607cba", "kind": "select", "ix": 1, "__id": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a|dc275676-ad80-4db1-b3ef-9bfb1f607cba|select|1" }, { "view": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a", "action": "f602a229-8512-4c4c-aebc-c16c68926e8d", "kind": "select", "ix": 0, "__id": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a|f602a229-8512-4c4c-aebc-c16c68926e8d|select|0" }, { "view": "employees", "action": "71256db8-9484-44a8-abb3-19b2f0b2d983", "kind": "select", "ix": 0, "__id": "employees|71256db8-9484-44a8-abb3-19b2f0b2d983|select|0" }, { "view": "employees", "action": "276af01a-c07d-441e-aa63-55548cdee363", "kind": "project", "ix": 9007199254740991, "__id": "employees|276af01a-c07d-441e-aa63-55548cdee363|project|9007199254740991" }, { "view": "employees|bit", "action": "2943bda0-19db-4662-b45e-8fdd484a31af", "kind": "select", "ix": 0, "__id": "employees|bit|2943bda0-19db-4662-b45e-8fdd484a31af|select|0" }, { "view": "employees|bit", "action": "c58ab1a2-2397-4b07-8c89-18385172aa50", "kind": "select", "ix": 1, "__id": "employees|bit|c58ab1a2-2397-4b07-8c89-18385172aa50|select|1" }, { "view": "employees|bit", "action": "a45744cf-128e-4afd-b981-4167878f916d", "kind": "calculate", "ix": 2, "__id": "employees|bit|a45744cf-128e-4afd-b981-4167878f916d|calculate|2" }, { "view": "employees|bit", "action": "64b345f5-fcff-41c6-91ca-91076f3631c3", "kind": "project", "ix": 9007199254740991, "__id": "employees|bit|64b345f5-fcff-41c6-91ca-91076f3631c3|project|9007199254740991" }, { "view": "sum of salaries per department", "action": "a4eb6ded-daf3-40de-9629-1173d5dd6a54", "kind": "select", "ix": 0, "__id": "sum of salaries per department|a4eb6ded-daf3-40de-9629-1173d5dd6a54|select|0" }, { "view": "sum of salaries per department", "action": "aee33461-80bf-4113-af0b-0c290ec18af0", "kind": "select", "ix": 1, "__id": "sum of salaries per department|aee33461-80bf-4113-af0b-0c290ec18af0|select|1" }, { "view": "sum of salaries per department", "action": "79159622-884b-4122-a586-b2f0884e0222", "kind": "select", "ix": 2, "__id": "sum of salaries per department|79159622-884b-4122-a586-b2f0884e0222|select|2" }, { "view": "sum of salaries per department", "action": "e001146b-2df1-4383-833c-df41c7091f6c", "kind": "select", "ix": 3, "__id": "sum of salaries per department|e001146b-2df1-4383-833c-df41c7091f6c|select|3" }, { "view": "sum of salaries per department", "action": "c2147101-16a9-4da2-bbc5-7bcb14a9803d", "kind": "aggregate", "ix": 4, "__id": "sum of salaries per department|c2147101-16a9-4da2-bbc5-7bcb14a9803d|aggregate|4" }, { "view": "sum of salaries per department", "action": "be08fba4-4fd5-4596-95f2-09d430ad58bb", "kind": "group", "ix": 9007199254740991, "__id": "sum of salaries per department|be08fba4-4fd5-4596-95f2-09d430ad58bb|group|9007199254740991" }, { "view": "sum of salaries per department", "action": "639125ca-4db3-402d-982c-bd5d7d2fb601", "kind": "project", "ix": 9007199254740991, "__id": "sum of salaries per department|639125ca-4db3-402d-982c-bd5d7d2fb601|project|9007199254740991" }, { "view": "sum of salaries per department|bit", "action": "6de3fe99-7eb2-4c9f-b895-656768674f37", "kind": "select", "ix": 0, "__id": "sum of salaries per department|bit|6de3fe99-7eb2-4c9f-b895-656768674f37|select|0" }, { "view": "sum of salaries per department|bit", "action": "413e647a-fe52-4ffe-8c0d-dd33fd62e4fc", "kind": "select", "ix": 1, "__id": "sum of salaries per department|bit|413e647a-fe52-4ffe-8c0d-dd33fd62e4fc|select|1" }, { "view": "sum of salaries per department|bit", "action": "45f13c10-23fd-4ba7-b40b-91cf60815804", "kind": "calculate", "ix": 2, "__id": "sum of salaries per department|bit|45f13c10-23fd-4ba7-b40b-91cf60815804|calculate|2" }, { "view": "sum of salaries per department|bit", "action": "d616eb26-c106-4cfc-8b62-9c6d526a6806", "kind": "project", "ix": 9007199254740991, "__id": "sum of salaries per department|bit|d616eb26-c106-4cfc-8b62-9c6d526a6806|project|9007199254740991" }, { "view": "generated eav", "action": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "kind": "union", "ix": 1, "__id": "generated eav|sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|union|1" }], "action source": [{ "action": "b02e0ae8-90a7-4e76-a6d4-9a9b5bdcaf18", "source view": "content blocks", "__id": "b02e0ae8-90a7-4e76-a6d4-9a9b5bdcaf18|content blocks" }, { "action": "1e5e0210-d109-4b8f-91cb-e14a422e11da", "source view": "manual entity", "__id": "1e5e0210-d109-4b8f-91cb-e14a422e11da|manual entity" }, { "action": "97f2afde-c0cd-41cb-98ec-51f268feb47c", "source view": "added bits", "__id": "97f2afde-c0cd-41cb-98ec-51f268feb47c|added bits" }, { "action": "5bec8cc7-7c55-4a21-b055-728ee9202d6a", "source view": "entity eavs", "__id": "5bec8cc7-7c55-4a21-b055-728ee9202d6a|entity eavs" }, { "action": "9fbf8614-c71a-4a92-b757-71542af9f056", "source view": "entity eavs", "__id": "9fbf8614-c71a-4a92-b757-71542af9f056|entity eavs" }, { "action": "79451f35-89a2-4671-a1e1-d1ae785c1663", "source view": "entity eavs", "__id": "79451f35-89a2-4671-a1e1-d1ae785c1663|entity eavs" }, { "action": "10e5f68c-865d-4edf-ad3d-4b6e379ca923", "source view": "content blocks", "__id": "10e5f68c-865d-4edf-ad3d-4b6e379ca923|content blocks" }, { "action": "d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6", "source view": "parse eavs", "__id": "d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6|parse eavs" }, { "action": "b23dc854-3fec-4757-a478-d5388840acc1", "source view": "entity", "__id": "b23dc854-3fec-4757-a478-d5388840acc1|entity" }, { "action": "7de9fcc7-fc5b-4604-92fe-b9654589b84c", "source view": "entity eavs", "__id": "7de9fcc7-fc5b-4604-92fe-b9654589b84c|entity eavs" }, { "action": "entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "source view": "builtin entity eavs", "__id": "entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|builtin entity eavs" }, { "action": "entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "source view": "manual eav", "__id": "entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|manual eav" }, { "action": "entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "source view": "generated eav", "__id": "entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|generated eav" }, { "action": "entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "source view": "parsed content blocks", "__id": "entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|parsed content blocks" }, { "action": "entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "source view": "parsed eavs", "__id": "entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|parsed eavs" }, { "action": "entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "source view": "added eavs", "__id": "entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|added eavs" }, { "action": "1125f6a6-181c-430b-811a-39f20299a8ad", "source view": "parse eavs", "__id": "1125f6a6-181c-430b-811a-39f20299a8ad|parse eavs" }, { "action": "5605ce60-5b9c-460b-9554-f67f10bfe842", "source view": "lowercase", "__id": "5605ce60-5b9c-460b-9554-f67f10bfe842|lowercase" }, { "action": "eec9f039-08e6-46ba-b04b-84d9735808c2", "source view": "entity", "__id": "eec9f039-08e6-46ba-b04b-84d9735808c2|entity" }, { "action": "a576196d-84d5-43e6-9116-edf96b152a71", "source view": "entity eavs", "__id": "a576196d-84d5-43e6-9116-edf96b152a71|entity eavs" }, { "action": "5ff8a466-5a5c-46f2-850d-d0f5265b18c2", "source view": "lowercase eavs", "__id": "5ff8a466-5a5c-46f2-850d-d0f5265b18c2|lowercase eavs" }, { "action": "entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "source view": "builtin entity links", "__id": "entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|builtin entity links" }, { "action": "entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "source view": "eav entity links", "__id": "entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|eav entity links" }, { "action": "entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}", "source view": "is a attributes", "__id": "entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}|is a attributes" }, { "action": "directionless links <-- builtin directionless links <-- {\"entity\":\"entity\",\"link\":\"link\"}", "source view": "builtin directionless links", "__id": "directionless links <-- builtin directionless links <-- {\"entity\":\"entity\",\"link\":\"link\"}|builtin directionless links" }, { "action": "directionless links <-- entity links <-- {\"entity\":\"entity\",\"link\":\"link\"}", "source view": "entity links", "__id": "directionless links <-- entity links <-- {\"entity\":\"entity\",\"link\":\"link\"}|entity links" }, { "action": "directionless links <-- entity links <-- {\"entity\":\"link\",\"link\":\"entity\"}", "source view": "entity links", "__id": "directionless links <-- entity links <-- {\"entity\":\"link\",\"link\":\"entity\"}|entity links" }, { "action": "collection entities <-- builtin collection entities <-- {\"entity\":\"entity\",\"collection\":\"collection\"}", "source view": "builtin collection entities", "__id": "collection entities <-- builtin collection entities <-- {\"entity\":\"entity\",\"collection\":\"collection\"}|builtin collection entities" }, { "action": "collection entities <-- is a attributes <-- {\"entity\":\"entity\",\"collection\":\"collection\"}", "source view": "is a attributes", "__id": "collection entities <-- is a attributes <-- {\"entity\":\"entity\",\"collection\":\"collection\"}|is a attributes" }, { "action": "0c002f76-4ef9-48c6-8421-33084657a3ae", "source view": "count", "__id": "0c002f76-4ef9-48c6-8421-33084657a3ae|count" }, { "action": "64c8ae4c-cded-478d-9f4a-7ad1dc5c7185", "source view": "is a attributes", "__id": "64c8ae4c-cded-478d-9f4a-7ad1dc5c7185|is a attributes" }, { "action": "search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}", "source view": "builtin search", "__id": "search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}|builtin search" }, { "action": "search query <-- builtin search query <-- {\"id\":\"id\",\"search\":\"search\"}", "source view": "builtin search query", "__id": "search query <-- builtin search query <-- {\"id\":\"id\",\"search\":\"search\"}|builtin search query" }, { "action": "2db00496-2eff-4d2a-b487-4c3705805c3e", "source view": "search query", "__id": "2db00496-2eff-4d2a-b487-4c3705805c3e|search query" }, { "action": "1df78edc-b7df-452b-a73c-e2d5939ec8b9", "source view": "search", "__id": "1df78edc-b7df-452b-a73c-e2d5939ec8b9|search" }, { "action": "b844cb2b-7503-4346-b32d-d86191765a8f", "source view": "entity eavs", "__id": "b844cb2b-7503-4346-b32d-d86191765a8f|entity eavs" }, { "action": "9b37c2cd-5628-4d5e-8a69-916ca66cac87", "source view": "entity eavs", "__id": "9b37c2cd-5628-4d5e-8a69-916ca66cac87|entity eavs" }, { "action": "0d27fe25-b05e-44b9-9e45-af96a23bacbf", "source view": "entity eavs", "__id": "0d27fe25-b05e-44b9-9e45-af96a23bacbf|entity eavs" }, { "action": "31405d57-a5fb-44b0-ad91-a33da4edcaca", "source view": "entity eavs", "__id": "31405d57-a5fb-44b0-ad91-a33da4edcaca|entity eavs" }, { "action": "be9d0f9b-609a-4025-9568-c1e5dff96bc6", "source view": "entity eavs", "__id": "be9d0f9b-609a-4025-9568-c1e5dff96bc6|entity eavs" }, { "action": "b6943987-ea3e-4a9b-b011-ba7bc269a2ae", "source view": "entity eavs", "__id": "b6943987-ea3e-4a9b-b011-ba7bc269a2ae|entity eavs" }, { "action": "0a3d741e-dbd7-4e70-98a9-10a14f5b02e2", "source view": "entity eavs", "__id": "0a3d741e-dbd7-4e70-98a9-10a14f5b02e2|entity eavs" }, { "action": "dc275676-ad80-4db1-b3ef-9bfb1f607cba", "source view": "entity eavs", "__id": "dc275676-ad80-4db1-b3ef-9bfb1f607cba|entity eavs" }, { "action": "f602a229-8512-4c4c-aebc-c16c68926e8d", "source view": "collection entities", "__id": "f602a229-8512-4c4c-aebc-c16c68926e8d|collection entities" }, { "action": "71256db8-9484-44a8-abb3-19b2f0b2d983", "source view": "collection entities", "__id": "71256db8-9484-44a8-abb3-19b2f0b2d983|collection entities" }, { "action": "2943bda0-19db-4662-b45e-8fdd484a31af", "source view": "add bit action", "__id": "2943bda0-19db-4662-b45e-8fdd484a31af|add bit action" }, { "action": "c58ab1a2-2397-4b07-8c89-18385172aa50", "source view": "employees", "__id": "c58ab1a2-2397-4b07-8c89-18385172aa50|employees" }, { "action": "a45744cf-128e-4afd-b981-4167878f916d", "source view": "bit template", "__id": "a45744cf-128e-4afd-b981-4167878f916d|bit template" }, { "action": "a4eb6ded-daf3-40de-9629-1173d5dd6a54", "source view": "collection entities", "__id": "a4eb6ded-daf3-40de-9629-1173d5dd6a54|collection entities" }, { "action": "aee33461-80bf-4113-af0b-0c290ec18af0", "source view": "directionless links", "__id": "aee33461-80bf-4113-af0b-0c290ec18af0|directionless links" }, { "action": "79159622-884b-4122-a586-b2f0884e0222", "source view": "collection entities", "__id": "79159622-884b-4122-a586-b2f0884e0222|collection entities" }, { "action": "e001146b-2df1-4383-833c-df41c7091f6c", "source view": "entity eavs", "__id": "e001146b-2df1-4383-833c-df41c7091f6c|entity eavs" }, { "action": "c2147101-16a9-4da2-bbc5-7bcb14a9803d", "source view": "sum", "__id": "c2147101-16a9-4da2-bbc5-7bcb14a9803d|sum" }, { "action": "6de3fe99-7eb2-4c9f-b895-656768674f37", "source view": "add bit action", "__id": "6de3fe99-7eb2-4c9f-b895-656768674f37|add bit action" }, { "action": "413e647a-fe52-4ffe-8c0d-dd33fd62e4fc", "source view": "sum of salaries per department", "__id": "413e647a-fe52-4ffe-8c0d-dd33fd62e4fc|sum of salaries per department" }, { "action": "45f13c10-23fd-4ba7-b40b-91cf60815804", "source view": "bit template", "__id": "45f13c10-23fd-4ba7-b40b-91cf60815804|bit template" }, { "action": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "source view": "sum of salaries per department|bit", "__id": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|sum of salaries per department|bit" }], "action mapping": [{ "action": "230901a0-a9eb-480d-b8bd-152a27bba9d6", "from": "content", "to source": "b02e0ae8-90a7-4e76-a6d4-9a9b5bdcaf18", "to field": "content", "__id": "230901a0-a9eb-480d-b8bd-152a27bba9d6|content|b02e0ae8-90a7-4e76-a6d4-9a9b5bdcaf18|content" }, { "action": "230901a0-a9eb-480d-b8bd-152a27bba9d6", "from": "entity", "to source": "b02e0ae8-90a7-4e76-a6d4-9a9b5bdcaf18", "to field": "entity", "__id": "230901a0-a9eb-480d-b8bd-152a27bba9d6|entity|b02e0ae8-90a7-4e76-a6d4-9a9b5bdcaf18|entity" }, { "action": "5bec8cc7-7c55-4a21-b055-728ee9202d6a", "from": "entity", "to source": "79451f35-89a2-4671-a1e1-d1ae785c1663", "to field": "entity", "__id": "5bec8cc7-7c55-4a21-b055-728ee9202d6a|entity|79451f35-89a2-4671-a1e1-d1ae785c1663|entity" }, { "action": "0b8ce76d-9bba-409f-9208-bc0b260d989e", "from": "content", "to source": "97f2afde-c0cd-41cb-98ec-51f268feb47c", "to field": "content", "__id": "0b8ce76d-9bba-409f-9208-bc0b260d989e|content|97f2afde-c0cd-41cb-98ec-51f268feb47c|content" }, { "action": "0b8ce76d-9bba-409f-9208-bc0b260d989e", "from": "entity", "to source": "97f2afde-c0cd-41cb-98ec-51f268feb47c", "to field": "entity", "__id": "0b8ce76d-9bba-409f-9208-bc0b260d989e|entity|97f2afde-c0cd-41cb-98ec-51f268feb47c|entity" }, { "action": "1e5e0210-d109-4b8f-91cb-e14a422e11da", "from": "entity", "to source": "97f2afde-c0cd-41cb-98ec-51f268feb47c", "to field": "entity", "__id": "1e5e0210-d109-4b8f-91cb-e14a422e11da|entity|97f2afde-c0cd-41cb-98ec-51f268feb47c|entity" }, { "action": "b4035b12-6251-45dd-8983-325bd9164a18", "from": "content", "to source": "9fbf8614-c71a-4a92-b757-71542af9f056", "to field": "value", "__id": "b4035b12-6251-45dd-8983-325bd9164a18|content|9fbf8614-c71a-4a92-b757-71542af9f056|value" }, { "action": "b4035b12-6251-45dd-8983-325bd9164a18", "from": "entity", "to source": "5bec8cc7-7c55-4a21-b055-728ee9202d6a", "to field": "value", "__id": "b4035b12-6251-45dd-8983-325bd9164a18|entity|5bec8cc7-7c55-4a21-b055-728ee9202d6a|value" }, { "action": "b4035b12-6251-45dd-8983-325bd9164a18", "from": "block", "to source": "79451f35-89a2-4671-a1e1-d1ae785c1663", "to field": "entity", "__id": "b4035b12-6251-45dd-8983-325bd9164a18|block|79451f35-89a2-4671-a1e1-d1ae785c1663|entity" }, { "action": "9fbf8614-c71a-4a92-b757-71542af9f056", "from": "entity", "to source": "79451f35-89a2-4671-a1e1-d1ae785c1663", "to field": "entity", "__id": "9fbf8614-c71a-4a92-b757-71542af9f056|entity|79451f35-89a2-4671-a1e1-d1ae785c1663|entity" }, { "action": "e9f0d3d0-e035-409c-86a0-93119a6f34ea", "from": "attribute", "to source": "1125f6a6-181c-430b-811a-39f20299a8ad", "to field": "attribute", "__id": "e9f0d3d0-e035-409c-86a0-93119a6f34ea|attribute|1125f6a6-181c-430b-811a-39f20299a8ad|attribute" }, { "action": "e9f0d3d0-e035-409c-86a0-93119a6f34ea", "from": "entity", "to source": "10e5f68c-865d-4edf-ad3d-4b6e379ca923", "to field": "entity", "__id": "e9f0d3d0-e035-409c-86a0-93119a6f34ea|entity|10e5f68c-865d-4edf-ad3d-4b6e379ca923|entity" }, { "action": "1125f6a6-181c-430b-811a-39f20299a8ad", "from": "text", "to source": "10e5f68c-865d-4edf-ad3d-4b6e379ca923", "to field": "content", "__id": "1125f6a6-181c-430b-811a-39f20299a8ad|text|10e5f68c-865d-4edf-ad3d-4b6e379ca923|content" }, { "action": "1125f6a6-181c-430b-811a-39f20299a8ad", "from": "entity", "to source": "10e5f68c-865d-4edf-ad3d-4b6e379ca923", "to field": "entity", "__id": "1125f6a6-181c-430b-811a-39f20299a8ad|entity|10e5f68c-865d-4edf-ad3d-4b6e379ca923|entity" }, { "action": "d183591e-f1fb-448e-b430-d1f37393e810", "from": "attribute", "to source": "d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6", "to field": "attribute", "__id": "d183591e-f1fb-448e-b430-d1f37393e810|attribute|d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6|attribute" }, { "action": "d183591e-f1fb-448e-b430-d1f37393e810", "from": "entity", "to source": "b23dc854-3fec-4757-a478-d5388840acc1", "to field": "entity", "__id": "d183591e-f1fb-448e-b430-d1f37393e810|entity|b23dc854-3fec-4757-a478-d5388840acc1|entity" }, { "action": "9fac0c63-a68a-43ec-b69f-09f29c15ddb6", "from": "entity", "to source": "7de9fcc7-fc5b-4604-92fe-b9654589b84c", "to field": "entity", "__id": "9fac0c63-a68a-43ec-b69f-09f29c15ddb6|entity|7de9fcc7-fc5b-4604-92fe-b9654589b84c|entity" }, { "action": "d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6", "from": "text", "to source": "b23dc854-3fec-4757-a478-d5388840acc1", "to field": "content", "__id": "d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6|text|b23dc854-3fec-4757-a478-d5388840acc1|content" }, { "action": "d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6", "from": "entity", "to source": "b23dc854-3fec-4757-a478-d5388840acc1", "to field": "entity", "__id": "d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6|entity|b23dc854-3fec-4757-a478-d5388840acc1|entity" }, { "action": "9fac0c63-a68a-43ec-b69f-09f29c15ddb6", "from": "collection", "to source": "7de9fcc7-fc5b-4604-92fe-b9654589b84c", "to field": "value", "__id": "9fac0c63-a68a-43ec-b69f-09f29c15ddb6|collection|7de9fcc7-fc5b-4604-92fe-b9654589b84c|value" }, { "action": "entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "entity", "to source": "builtin entity eavs", "to field": "entity", "__id": "entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|entity|builtin entity eavs|entity" }, { "action": "entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "attribute", "to source": "builtin entity eavs", "to field": "attribute", "__id": "entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|attribute|builtin entity eavs|attribute" }, { "action": "entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "value", "to source": "builtin entity eavs", "to field": "value", "__id": "entity eavs <-- builtin entity eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|value|builtin entity eavs|value" }, { "action": "entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "entity", "to source": "manual eav", "to field": "entity", "__id": "entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|entity|manual eav|entity" }, { "action": "entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "attribute", "to source": "manual eav", "to field": "attribute", "__id": "entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|attribute|manual eav|attribute" }, { "action": "entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "value", "to source": "manual eav", "to field": "value", "__id": "entity eavs <-- manual eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|value|manual eav|value" }, { "action": "entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "entity", "to source": "generated eav", "to field": "entity", "__id": "entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|entity|generated eav|entity" }, { "action": "entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "attribute", "to source": "generated eav", "to field": "attribute", "__id": "entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|attribute|generated eav|attribute" }, { "action": "entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "value", "to source": "generated eav", "to field": "value", "__id": "entity eavs <-- generated eav <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|value|generated eav|value" }, { "action": "entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "entity", "to source": "parsed content blocks", "to field": "entity", "__id": "entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|entity|parsed content blocks|entity" }, { "action": "entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "attribute", "to source": "parsed content blocks", "to field": "attribute", "__id": "entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|attribute|parsed content blocks|attribute" }, { "action": "entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "value", "to source": "parsed content blocks", "to field": "value", "__id": "entity eavs <-- parsed content blocks <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|value|parsed content blocks|value" }, { "action": "entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "entity", "to source": "parsed eavs", "to field": "entity", "__id": "entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|entity|parsed eavs|entity" }, { "action": "entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "attribute", "to source": "parsed eavs", "to field": "attribute", "__id": "entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|attribute|parsed eavs|attribute" }, { "action": "entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "value", "to source": "parsed eavs", "to field": "value", "__id": "entity eavs <-- parsed eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|value|parsed eavs|value" }, { "action": "entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "entity", "to source": "added eavs", "to field": "entity", "__id": "entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|entity|added eavs|entity" }, { "action": "entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "attribute", "to source": "added eavs", "to field": "attribute", "__id": "entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|attribute|added eavs|attribute" }, { "action": "entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}", "from": "value", "to source": "added eavs", "to field": "value", "__id": "entity eavs <-- added eavs <-- {\"entity\":\"entity\",\"attribute\":\"attribute\",\"value\":\"value\"}|value|added eavs|value" }, { "action": "e9f0d3d0-e035-409c-86a0-93119a6f34ea", "from": "value", "to source": "1125f6a6-181c-430b-811a-39f20299a8ad", "to field": "value", "__id": "e9f0d3d0-e035-409c-86a0-93119a6f34ea|value|1125f6a6-181c-430b-811a-39f20299a8ad|value" }, { "action": "d183591e-f1fb-448e-b430-d1f37393e810", "from": "value", "to source": "d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6", "to field": "value", "__id": "d183591e-f1fb-448e-b430-d1f37393e810|value|d63b8a4f-2d0f-441e-b6ab-7ab1b5a1d5a6|value" }, { "action": "eec9f039-08e6-46ba-b04b-84d9735808c2", "from": "entity", "to source": "5ff8a466-5a5c-46f2-850d-d0f5265b18c2", "to field": "value", "__id": "eec9f039-08e6-46ba-b04b-84d9735808c2|entity|5ff8a466-5a5c-46f2-850d-d0f5265b18c2|value" }, { "action": "228de452-b96e-4008-bec9-0ef023c351fc", "from": "value", "to source": "5605ce60-5b9c-460b-9554-f67f10bfe842", "to field": "result", "__id": "228de452-b96e-4008-bec9-0ef023c351fc|value|5605ce60-5b9c-460b-9554-f67f10bfe842|result" }, { "action": "228de452-b96e-4008-bec9-0ef023c351fc", "from": "attribute", "to source": "a576196d-84d5-43e6-9116-edf96b152a71", "to field": "attribute", "__id": "228de452-b96e-4008-bec9-0ef023c351fc|attribute|a576196d-84d5-43e6-9116-edf96b152a71|attribute" }, { "action": "228de452-b96e-4008-bec9-0ef023c351fc", "from": "entity", "to source": "a576196d-84d5-43e6-9116-edf96b152a71", "to field": "entity", "__id": "228de452-b96e-4008-bec9-0ef023c351fc|entity|a576196d-84d5-43e6-9116-edf96b152a71|entity" }, { "action": "5605ce60-5b9c-460b-9554-f67f10bfe842", "from": "text", "to source": "a576196d-84d5-43e6-9116-edf96b152a71", "to field": "value", "__id": "5605ce60-5b9c-460b-9554-f67f10bfe842|text|a576196d-84d5-43e6-9116-edf96b152a71|value" }, { "action": "952147cb-02c8-43f7-833b-76cdcea3e6d0", "from": "link", "to source": "eec9f039-08e6-46ba-b04b-84d9735808c2", "to field": "entity", "__id": "952147cb-02c8-43f7-833b-76cdcea3e6d0|link|eec9f039-08e6-46ba-b04b-84d9735808c2|entity" }, { "action": "952147cb-02c8-43f7-833b-76cdcea3e6d0", "from": "entity", "to source": "5ff8a466-5a5c-46f2-850d-d0f5265b18c2", "to field": "entity", "__id": "952147cb-02c8-43f7-833b-76cdcea3e6d0|entity|5ff8a466-5a5c-46f2-850d-d0f5265b18c2|entity" }, { "action": "952147cb-02c8-43f7-833b-76cdcea3e6d0", "from": "type", "to source": "5ff8a466-5a5c-46f2-850d-d0f5265b18c2", "to field": "attribute", "__id": "952147cb-02c8-43f7-833b-76cdcea3e6d0|type|5ff8a466-5a5c-46f2-850d-d0f5265b18c2|attribute" }, { "action": "entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "from": "entity", "to source": "builtin entity links", "to field": "entity", "__id": "entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|entity|builtin entity links|entity" }, { "action": "entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "from": "link", "to source": "builtin entity links", "to field": "link", "__id": "entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|link|builtin entity links|link" }, { "action": "entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "from": "type", "to source": "builtin entity links", "to field": "type", "__id": "entity links <-- builtin entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|type|builtin entity links|type" }, { "action": "entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "from": "entity", "to source": "eav entity links", "to field": "entity", "__id": "entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|entity|eav entity links|entity" }, { "action": "entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "from": "link", "to source": "eav entity links", "to field": "link", "__id": "entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|link|eav entity links|link" }, { "action": "entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}", "from": "type", "to source": "eav entity links", "to field": "type", "__id": "entity links <-- eav entity links <-- {\"entity\":\"entity\",\"link\":\"link\",\"type\":\"type\"}|type|eav entity links|type" }, { "action": "entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}", "from": "entity", "to source": "is a attributes", "to field": "entity", "__id": "entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}|entity|is a attributes|entity" }, { "action": "entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}", "from": "link", "to source": "is a attributes", "to field": "collection", "__id": "entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}|link|is a attributes|collection" }, { "action": "directionless links <-- builtin directionless links <-- {\"entity\":\"entity\",\"link\":\"link\"}", "from": "entity", "to source": "builtin directionless links", "to field": "entity", "__id": "directionless links <-- builtin directionless links <-- {\"entity\":\"entity\",\"link\":\"link\"}|entity|builtin directionless links|entity" }, { "action": "directionless links <-- builtin directionless links <-- {\"entity\":\"entity\",\"link\":\"link\"}", "from": "link", "to source": "builtin directionless links", "to field": "link", "__id": "directionless links <-- builtin directionless links <-- {\"entity\":\"entity\",\"link\":\"link\"}|link|builtin directionless links|link" }, { "action": "directionless links <-- entity links <-- {\"entity\":\"entity\",\"link\":\"link\"}", "from": "entity", "to source": "entity links", "to field": "entity", "__id": "directionless links <-- entity links <-- {\"entity\":\"entity\",\"link\":\"link\"}|entity|entity links|entity" }, { "action": "directionless links <-- entity links <-- {\"entity\":\"entity\",\"link\":\"link\"}", "from": "link", "to source": "entity links", "to field": "link", "__id": "directionless links <-- entity links <-- {\"entity\":\"entity\",\"link\":\"link\"}|link|entity links|link" }, { "action": "directionless links <-- entity links <-- {\"entity\":\"link\",\"link\":\"entity\"}", "from": "entity", "to source": "entity links", "to field": "link", "__id": "directionless links <-- entity links <-- {\"entity\":\"link\",\"link\":\"entity\"}|entity|entity links|link" }, { "action": "directionless links <-- entity links <-- {\"entity\":\"link\",\"link\":\"entity\"}", "from": "link", "to source": "entity links", "to field": "entity", "__id": "directionless links <-- entity links <-- {\"entity\":\"link\",\"link\":\"entity\"}|link|entity links|entity" }, { "action": "collection entities <-- builtin collection entities <-- {\"entity\":\"entity\",\"collection\":\"collection\"}", "from": "entity", "to source": "builtin collection entities", "to field": "entity", "__id": "collection entities <-- builtin collection entities <-- {\"entity\":\"entity\",\"collection\":\"collection\"}|entity|builtin collection entities|entity" }, { "action": "collection entities <-- builtin collection entities <-- {\"entity\":\"entity\",\"collection\":\"collection\"}", "from": "collection", "to source": "builtin collection entities", "to field": "collection", "__id": "collection entities <-- builtin collection entities <-- {\"entity\":\"entity\",\"collection\":\"collection\"}|collection|builtin collection entities|collection" }, { "action": "collection entities <-- is a attributes <-- {\"entity\":\"entity\",\"collection\":\"collection\"}", "from": "entity", "to source": "is a attributes", "to field": "entity", "__id": "collection entities <-- is a attributes <-- {\"entity\":\"entity\",\"collection\":\"collection\"}|entity|is a attributes|entity" }, { "action": "collection entities <-- is a attributes <-- {\"entity\":\"entity\",\"collection\":\"collection\"}", "from": "collection", "to source": "is a attributes", "to field": "collection", "__id": "collection entities <-- is a attributes <-- {\"entity\":\"entity\",\"collection\":\"collection\"}|collection|is a attributes|collection" }, { "action": "ade245fa-ff66-456b-b52e-400817180c29", "from": "count", "to source": "0c002f76-4ef9-48c6-8421-33084657a3ae", "to field": "count", "__id": "ade245fa-ff66-456b-b52e-400817180c29|count|0c002f76-4ef9-48c6-8421-33084657a3ae|count" }, { "action": "ade245fa-ff66-456b-b52e-400817180c29", "from": "collection", "to source": "64c8ae4c-cded-478d-9f4a-7ad1dc5c7185", "to field": "collection", "__id": "ade245fa-ff66-456b-b52e-400817180c29|collection|64c8ae4c-cded-478d-9f4a-7ad1dc5c7185|collection" }, { "action": "search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}", "from": "id", "to source": "builtin search", "to field": "id", "__id": "search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}|id|builtin search|id" }, { "action": "search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}", "from": "top", "to source": "builtin search", "to field": "top", "__id": "search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}|top|builtin search|top" }, { "action": "search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}", "from": "left", "to source": "builtin search", "to field": "left", "__id": "search <-- builtin search <-- {\"id\":\"id\",\"top\":\"top\",\"left\":\"left\"}|left|builtin search|left" }, { "action": "search query <-- builtin search query <-- {\"id\":\"id\",\"search\":\"search\"}", "from": "id", "to source": "builtin search query", "to field": "id", "__id": "search query <-- builtin search query <-- {\"id\":\"id\",\"search\":\"search\"}|id|builtin search query|id" }, { "action": "search query <-- builtin search query <-- {\"id\":\"id\",\"search\":\"search\"}", "from": "search", "to source": "builtin search query", "to field": "search", "__id": "search query <-- builtin search query <-- {\"id\":\"id\",\"search\":\"search\"}|search|builtin search query|search" }, { "action": "3f28818f-6e0c-4352-af3c-b909993e6fce", "from": "left", "to source": "1df78edc-b7df-452b-a73c-e2d5939ec8b9", "to field": "left", "__id": "3f28818f-6e0c-4352-af3c-b909993e6fce|left|1df78edc-b7df-452b-a73c-e2d5939ec8b9|left" }, { "action": "3f28818f-6e0c-4352-af3c-b909993e6fce", "from": "top", "to source": "1df78edc-b7df-452b-a73c-e2d5939ec8b9", "to field": "top", "__id": "3f28818f-6e0c-4352-af3c-b909993e6fce|top|1df78edc-b7df-452b-a73c-e2d5939ec8b9|top" }, { "action": "3f28818f-6e0c-4352-af3c-b909993e6fce", "from": "search", "to source": "2db00496-2eff-4d2a-b487-4c3705805c3e", "to field": "search", "__id": "3f28818f-6e0c-4352-af3c-b909993e6fce|search|2db00496-2eff-4d2a-b487-4c3705805c3e|search" }, { "action": "3f28818f-6e0c-4352-af3c-b909993e6fce", "from": "id", "to source": "1df78edc-b7df-452b-a73c-e2d5939ec8b9", "to field": "id", "__id": "3f28818f-6e0c-4352-af3c-b909993e6fce|id|1df78edc-b7df-452b-a73c-e2d5939ec8b9|id" }, { "action": "2db00496-2eff-4d2a-b487-4c3705805c3e", "from": "id", "to source": "1df78edc-b7df-452b-a73c-e2d5939ec8b9", "to field": "id", "__id": "2db00496-2eff-4d2a-b487-4c3705805c3e|id|1df78edc-b7df-452b-a73c-e2d5939ec8b9|id" }, { "action": "a854f706-a256-48ec-9d90-0eb297a50d06", "from": "update", "to source": "9b37c2cd-5628-4d5e-8a69-916ca66cac87", "to field": "value", "__id": "a854f706-a256-48ec-9d90-0eb297a50d06|update|9b37c2cd-5628-4d5e-8a69-916ca66cac87|value" }, { "action": "a854f706-a256-48ec-9d90-0eb297a50d06", "from": "render", "to source": "0d27fe25-b05e-44b9-9e45-af96a23bacbf", "to field": "value", "__id": "a854f706-a256-48ec-9d90-0eb297a50d06|render|0d27fe25-b05e-44b9-9e45-af96a23bacbf|value" }, { "action": "a854f706-a256-48ec-9d90-0eb297a50d06", "from": "perf stats", "to source": "b844cb2b-7503-4346-b32d-d86191765a8f", "to field": "value", "__id": "a854f706-a256-48ec-9d90-0eb297a50d06|perf stats|b844cb2b-7503-4346-b32d-d86191765a8f|value" }, { "action": "9b46fcb4-ae02-4b8e-b23c-d462c2c519b0", "from": "top", "to source": "dc275676-ad80-4db1-b3ef-9bfb1f607cba", "to field": "value", "__id": "9b46fcb4-ae02-4b8e-b23c-d462c2c519b0|top|dc275676-ad80-4db1-b3ef-9bfb1f607cba|value" }, { "action": "9b46fcb4-ae02-4b8e-b23c-d462c2c519b0", "from": "search", "to source": "f602a229-8512-4c4c-aebc-c16c68926e8d", "to field": "entity", "__id": "9b46fcb4-ae02-4b8e-b23c-d462c2c519b0|search|f602a229-8512-4c4c-aebc-c16c68926e8d|entity" }, { "action": "b6943987-ea3e-4a9b-b011-ba7bc269a2ae", "from": "entity", "to source": "f602a229-8512-4c4c-aebc-c16c68926e8d", "to field": "entity", "__id": "b6943987-ea3e-4a9b-b011-ba7bc269a2ae|entity|f602a229-8512-4c4c-aebc-c16c68926e8d|entity" }, { "action": "9b46fcb4-ae02-4b8e-b23c-d462c2c519b0", "from": "search 2", "to source": "b6943987-ea3e-4a9b-b011-ba7bc269a2ae", "to field": "value", "__id": "9b46fcb4-ae02-4b8e-b23c-d462c2c519b0|search 2|b6943987-ea3e-4a9b-b011-ba7bc269a2ae|value" }, { "action": "9b46fcb4-ae02-4b8e-b23c-d462c2c519b0", "from": "left", "to source": "0a3d741e-dbd7-4e70-98a9-10a14f5b02e2", "to field": "value", "__id": "9b46fcb4-ae02-4b8e-b23c-d462c2c519b0|left|0a3d741e-dbd7-4e70-98a9-10a14f5b02e2|value" }, { "action": "0a3d741e-dbd7-4e70-98a9-10a14f5b02e2", "from": "entity", "to source": "f602a229-8512-4c4c-aebc-c16c68926e8d", "to field": "entity", "__id": "0a3d741e-dbd7-4e70-98a9-10a14f5b02e2|entity|f602a229-8512-4c4c-aebc-c16c68926e8d|entity" }, { "action": "dc275676-ad80-4db1-b3ef-9bfb1f607cba", "from": "entity", "to source": "f602a229-8512-4c4c-aebc-c16c68926e8d", "to field": "entity", "__id": "dc275676-ad80-4db1-b3ef-9bfb1f607cba|entity|f602a229-8512-4c4c-aebc-c16c68926e8d|entity" }, { "action": "a854f706-a256-48ec-9d90-0eb297a50d06", "from": "ui compile", "to source": "31405d57-a5fb-44b0-ad91-a33da4edcaca", "to field": "value", "__id": "a854f706-a256-48ec-9d90-0eb297a50d06|ui compile|31405d57-a5fb-44b0-ad91-a33da4edcaca|value" }, { "action": "a854f706-a256-48ec-9d90-0eb297a50d06", "from": "root", "to source": "be9d0f9b-609a-4025-9568-c1e5dff96bc6", "to field": "value", "__id": "a854f706-a256-48ec-9d90-0eb297a50d06|root|be9d0f9b-609a-4025-9568-c1e5dff96bc6|value" }, { "action": "276af01a-c07d-441e-aa63-55548cdee363", "from": "employee", "to source": "71256db8-9484-44a8-abb3-19b2f0b2d983", "to field": "entity", "__id": "276af01a-c07d-441e-aa63-55548cdee363|employee|71256db8-9484-44a8-abb3-19b2f0b2d983|entity" }, { "action": "a45744cf-128e-4afd-b981-4167878f916d", "from": "row", "to source": "c58ab1a2-2397-4b07-8c89-18385172aa50", "__id": "a45744cf-128e-4afd-b981-4167878f916d|row|c58ab1a2-2397-4b07-8c89-18385172aa50|undefined" }, { "action": "a45744cf-128e-4afd-b981-4167878f916d", "from": "template", "to source": "2943bda0-19db-4662-b45e-8fdd484a31af", "to field": "template", "__id": "a45744cf-128e-4afd-b981-4167878f916d|template|2943bda0-19db-4662-b45e-8fdd484a31af|template" }, { "action": "a45744cf-128e-4afd-b981-4167878f916d", "from": "action", "to source": "2943bda0-19db-4662-b45e-8fdd484a31af", "to field": "action", "__id": "a45744cf-128e-4afd-b981-4167878f916d|action|2943bda0-19db-4662-b45e-8fdd484a31af|action" }, { "action": "64b345f5-fcff-41c6-91ca-91076f3631c3", "from": "entity", "to source": "a45744cf-128e-4afd-b981-4167878f916d", "to field": "entity", "__id": "64b345f5-fcff-41c6-91ca-91076f3631c3|entity|a45744cf-128e-4afd-b981-4167878f916d|entity" }, { "action": "64b345f5-fcff-41c6-91ca-91076f3631c3", "from": "attribute", "to source": "a45744cf-128e-4afd-b981-4167878f916d", "to field": "attribute", "__id": "64b345f5-fcff-41c6-91ca-91076f3631c3|attribute|a45744cf-128e-4afd-b981-4167878f916d|attribute" }, { "action": "64b345f5-fcff-41c6-91ca-91076f3631c3", "from": "value", "to source": "a45744cf-128e-4afd-b981-4167878f916d", "to field": "value", "__id": "64b345f5-fcff-41c6-91ca-91076f3631c3|value|a45744cf-128e-4afd-b981-4167878f916d|value" }, { "action": "aee33461-80bf-4113-af0b-0c290ec18af0", "from": "entity", "to source": "a4eb6ded-daf3-40de-9629-1173d5dd6a54", "to field": "entity", "__id": "aee33461-80bf-4113-af0b-0c290ec18af0|entity|a4eb6ded-daf3-40de-9629-1173d5dd6a54|entity" }, { "action": "79159622-884b-4122-a586-b2f0884e0222", "from": "entity", "to source": "aee33461-80bf-4113-af0b-0c290ec18af0", "to field": "link", "__id": "79159622-884b-4122-a586-b2f0884e0222|entity|aee33461-80bf-4113-af0b-0c290ec18af0|link" }, { "action": "e001146b-2df1-4383-833c-df41c7091f6c", "from": "entity", "to source": "79159622-884b-4122-a586-b2f0884e0222", "to field": "entity", "__id": "e001146b-2df1-4383-833c-df41c7091f6c|entity|79159622-884b-4122-a586-b2f0884e0222|entity" }, { "action": "c2147101-16a9-4da2-bbc5-7bcb14a9803d", "from": "value", "to source": "e001146b-2df1-4383-833c-df41c7091f6c", "to field": "value", "__id": "c2147101-16a9-4da2-bbc5-7bcb14a9803d|value|e001146b-2df1-4383-833c-df41c7091f6c|value" }, { "action": "639125ca-4db3-402d-982c-bd5d7d2fb601", "from": "department", "to source": "a4eb6ded-daf3-40de-9629-1173d5dd6a54", "to field": "entity", "__id": "639125ca-4db3-402d-982c-bd5d7d2fb601|department|a4eb6ded-daf3-40de-9629-1173d5dd6a54|entity" }, { "action": "639125ca-4db3-402d-982c-bd5d7d2fb601", "from": "employee", "to source": "79159622-884b-4122-a586-b2f0884e0222", "to field": "entity", "__id": "639125ca-4db3-402d-982c-bd5d7d2fb601|employee|79159622-884b-4122-a586-b2f0884e0222|entity" }, { "action": "639125ca-4db3-402d-982c-bd5d7d2fb601", "from": "salary", "to source": "e001146b-2df1-4383-833c-df41c7091f6c", "to field": "value", "__id": "639125ca-4db3-402d-982c-bd5d7d2fb601|salary|e001146b-2df1-4383-833c-df41c7091f6c|value" }, { "action": "639125ca-4db3-402d-982c-bd5d7d2fb601", "from": "sum", "to source": "c2147101-16a9-4da2-bbc5-7bcb14a9803d", "to field": "sum", "__id": "639125ca-4db3-402d-982c-bd5d7d2fb601|sum|c2147101-16a9-4da2-bbc5-7bcb14a9803d|sum" }, { "action": "45f13c10-23fd-4ba7-b40b-91cf60815804", "from": "row", "to source": "413e647a-fe52-4ffe-8c0d-dd33fd62e4fc", "__id": "45f13c10-23fd-4ba7-b40b-91cf60815804|row|413e647a-fe52-4ffe-8c0d-dd33fd62e4fc|undefined" }, { "action": "45f13c10-23fd-4ba7-b40b-91cf60815804", "from": "template", "to source": "6de3fe99-7eb2-4c9f-b895-656768674f37", "to field": "template", "__id": "45f13c10-23fd-4ba7-b40b-91cf60815804|template|6de3fe99-7eb2-4c9f-b895-656768674f37|template" }, { "action": "45f13c10-23fd-4ba7-b40b-91cf60815804", "from": "action", "to source": "6de3fe99-7eb2-4c9f-b895-656768674f37", "to field": "action", "__id": "45f13c10-23fd-4ba7-b40b-91cf60815804|action|6de3fe99-7eb2-4c9f-b895-656768674f37|action" }, { "action": "d616eb26-c106-4cfc-8b62-9c6d526a6806", "from": "entity", "to source": "45f13c10-23fd-4ba7-b40b-91cf60815804", "to field": "entity", "__id": "d616eb26-c106-4cfc-8b62-9c6d526a6806|entity|45f13c10-23fd-4ba7-b40b-91cf60815804|entity" }, { "action": "d616eb26-c106-4cfc-8b62-9c6d526a6806", "from": "attribute", "to source": "45f13c10-23fd-4ba7-b40b-91cf60815804", "to field": "attribute", "__id": "d616eb26-c106-4cfc-8b62-9c6d526a6806|attribute|45f13c10-23fd-4ba7-b40b-91cf60815804|attribute" }, { "action": "d616eb26-c106-4cfc-8b62-9c6d526a6806", "from": "value", "to source": "45f13c10-23fd-4ba7-b40b-91cf60815804", "to field": "value", "__id": "d616eb26-c106-4cfc-8b62-9c6d526a6806|value|45f13c10-23fd-4ba7-b40b-91cf60815804|value" }, { "action": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "from": "entity", "to source": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "to field": "entity", "__id": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|entity|sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|entity" }, { "action": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "from": "attribute", "to source": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "to field": "attribute", "__id": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|attribute|sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|attribute" }, { "action": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "from": "value", "to source": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "to field": "value", "__id": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|value|sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|value" }], "action mapping constant": [{ "action": "79451f35-89a2-4671-a1e1-d1ae785c1663", "from": "value", "value": "content block", "__id": "79451f35-89a2-4671-a1e1-d1ae785c1663|value|content block" }, { "action": "9fbf8614-c71a-4a92-b757-71542af9f056", "from": "attribute", "value": "content", "__id": "9fbf8614-c71a-4a92-b757-71542af9f056|attribute|content" }, { "action": "5bec8cc7-7c55-4a21-b055-728ee9202d6a", "from": "attribute", "value": "associated entity", "__id": "5bec8cc7-7c55-4a21-b055-728ee9202d6a|attribute|associated entity" }, { "action": "79451f35-89a2-4671-a1e1-d1ae785c1663", "from": "attribute", "value": "is a", "__id": "79451f35-89a2-4671-a1e1-d1ae785c1663|attribute|is a" }, { "action": "7de9fcc7-fc5b-4604-92fe-b9654589b84c", "from": "attribute", "value": "is a", "__id": "7de9fcc7-fc5b-4604-92fe-b9654589b84c|attribute|is a" }, { "action": "entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}", "from": "type", "value": "is a", "__id": "entity links <-- is a attributes <-- {\"entity\":\"entity\",\"link\":\"collection\",\"type\":[\"is a\"]}|type|is a" }, { "action": "31405d57-a5fb-44b0-ad91-a33da4edcaca", "from": "entity", "value": "render performance statistics", "__id": "31405d57-a5fb-44b0-ad91-a33da4edcaca|entity|render performance statistics" }, { "action": "31405d57-a5fb-44b0-ad91-a33da4edcaca", "from": "attribute", "value": "ui compile", "__id": "31405d57-a5fb-44b0-ad91-a33da4edcaca|attribute|ui compile" }, { "action": "be9d0f9b-609a-4025-9568-c1e5dff96bc6", "from": "entity", "value": "render performance statistics", "__id": "be9d0f9b-609a-4025-9568-c1e5dff96bc6|entity|render performance statistics" }, { "action": "be9d0f9b-609a-4025-9568-c1e5dff96bc6", "from": "attribute", "value": "root", "__id": "be9d0f9b-609a-4025-9568-c1e5dff96bc6|attribute|root" }, { "action": "b844cb2b-7503-4346-b32d-d86191765a8f", "from": "entity", "value": "render performance statistics", "__id": "b844cb2b-7503-4346-b32d-d86191765a8f|entity|render performance statistics" }, { "action": "b844cb2b-7503-4346-b32d-d86191765a8f", "from": "attribute", "value": "perf stats", "__id": "b844cb2b-7503-4346-b32d-d86191765a8f|attribute|perf stats" }, { "action": "b6943987-ea3e-4a9b-b011-ba7bc269a2ae", "from": "attribute", "value": "search", "__id": "b6943987-ea3e-4a9b-b011-ba7bc269a2ae|attribute|search" }, { "action": "0a3d741e-dbd7-4e70-98a9-10a14f5b02e2", "from": "attribute", "value": "left", "__id": "0a3d741e-dbd7-4e70-98a9-10a14f5b02e2|attribute|left" }, { "action": "dc275676-ad80-4db1-b3ef-9bfb1f607cba", "from": "attribute", "value": "top", "__id": "dc275676-ad80-4db1-b3ef-9bfb1f607cba|attribute|top" }, { "action": "f602a229-8512-4c4c-aebc-c16c68926e8d", "from": "collection", "value": "search", "__id": "f602a229-8512-4c4c-aebc-c16c68926e8d|collection|search" }, { "action": "9b37c2cd-5628-4d5e-8a69-916ca66cac87", "from": "entity", "value": "render performance statistics", "__id": "9b37c2cd-5628-4d5e-8a69-916ca66cac87|entity|render performance statistics" }, { "action": "9b37c2cd-5628-4d5e-8a69-916ca66cac87", "from": "attribute", "value": "update", "__id": "9b37c2cd-5628-4d5e-8a69-916ca66cac87|attribute|update" }, { "action": "0d27fe25-b05e-44b9-9e45-af96a23bacbf", "from": "entity", "value": "render performance statistics", "__id": "0d27fe25-b05e-44b9-9e45-af96a23bacbf|entity|render performance statistics" }, { "action": "0d27fe25-b05e-44b9-9e45-af96a23bacbf", "from": "attribute", "value": "render", "__id": "0d27fe25-b05e-44b9-9e45-af96a23bacbf|attribute|render" }, { "action": "71256db8-9484-44a8-abb3-19b2f0b2d983", "from": "collection", "value": "employee", "__id": "71256db8-9484-44a8-abb3-19b2f0b2d983|collection|employee" }, { "action": "2943bda0-19db-4662-b45e-8fdd484a31af", "from": "view", "value": "employees", "__id": "2943bda0-19db-4662-b45e-8fdd484a31af|view|employees" }, { "action": "a45744cf-128e-4afd-b981-4167878f916d", "from": "name", "value": "employees", "__id": "a45744cf-128e-4afd-b981-4167878f916d|name|employees" }, { "action": "a4eb6ded-daf3-40de-9629-1173d5dd6a54", "from": "collection", "value": "department", "__id": "a4eb6ded-daf3-40de-9629-1173d5dd6a54|collection|department" }, { "action": "79159622-884b-4122-a586-b2f0884e0222", "from": "collection", "value": "employee", "__id": "79159622-884b-4122-a586-b2f0884e0222|collection|employee" }, { "action": "e001146b-2df1-4383-833c-df41c7091f6c", "from": "attribute", "value": "salary", "__id": "e001146b-2df1-4383-833c-df41c7091f6c|attribute|salary" }, { "action": "6de3fe99-7eb2-4c9f-b895-656768674f37", "from": "view", "value": "sum of salaries per department", "__id": "6de3fe99-7eb2-4c9f-b895-656768674f37|view|sum of salaries per department" }, { "action": "45f13c10-23fd-4ba7-b40b-91cf60815804", "from": "name", "value": "sum of salaries per department", "__id": "45f13c10-23fd-4ba7-b40b-91cf60815804|name|sum of salaries per department" }, { "action": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "from": "source view", "value": "sum of salaries per department", "__id": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|source view|sum of salaries per department" }], "action mapping sorted": [{ "action": "563e4b9e-8122-45b6-93da-325b4135a10d", "ix": 0, "source": "64c8ae4c-cded-478d-9f4a-7ad1dc5c7185", "field": "collection", "direction": "ascending", "__id": "563e4b9e-8122-45b6-93da-325b4135a10d|0|64c8ae4c-cded-478d-9f4a-7ad1dc5c7185|collection|ascending" }, { "action": "be08fba4-4fd5-4596-95f2-09d430ad58bb", "ix": 0, "source": "a4eb6ded-daf3-40de-9629-1173d5dd6a54", "field": "entity", "direction": "ascending", "__id": "be08fba4-4fd5-4596-95f2-09d430ad58bb|0|a4eb6ded-daf3-40de-9629-1173d5dd6a54|entity|ascending" }], "action mapping limit": [], "recompile": [], "undefined": [], "manual eav": [{ "entity": "foo|manual content block", "attribute": "is a", "value": "content block", "__id": "foo|manual content block|is a|content block" }, { "entity": "foo|manual content block", "attribute": "source", "value": "manual", "__id": "foo|manual content block|source|manual" }, { "entity": "foo|manual content block", "attribute": "associated entity", "value": "foo", "__id": "foo|manual content block|associated entity|foo" }, { "entity": "foo|manual content block", "attribute": "content", "value": "Foo is a {is a: person} who is {age: 34} years old.", "__id": "foo|manual content block|content|Foo is a {is a: person} who is {age: 34} years old." }, { "entity": "zomg|manual content block", "attribute": "is a", "value": "content block", "__id": "zomg|manual content block|is a|content block" }, { "entity": "zomg|manual content block", "attribute": "source", "value": "manual", "__id": "zomg|manual content block|source|manual" }, { "entity": "zomg|manual content block", "attribute": "associated entity", "value": "zomg", "__id": "zomg|manual content block|associated entity|zomg" }, { "entity": "zomg|manual content block", "attribute": "content", "value": "zomg is a {is a: person} who is {age: 24} years old.", "__id": "zomg|manual content block|content|zomg is a {is a: person} who is {age: 24} years old." }, { "entity": "engineering|manual content block", "attribute": "is a", "value": "content block", "__id": "engineering|manual content block|is a|content block" }, { "entity": "engineering|manual content block", "attribute": "source", "value": "manual", "__id": "engineering|manual content block|source|manual" }, { "entity": "engineering|manual content block", "attribute": "associated entity", "value": "engineering", "__id": "engineering|manual content block|associated entity|engineering" }, { "entity": "engineering|manual content block", "attribute": "content", "value": "Engineering is a {is a: department} at {company: kodowa}, which currently includes:\n\n{chris granger}\n{josh cole}\n{jamie brandon}\n{corey montella}\n{eric hoffman}", "__id": "engineering|manual content block|content|Engineering is a {is a: department} at {company: kodowa}, which currently includes:\n\n{chris granger}\n{josh cole}\n{jamie brandon}\n{corey montella}\n{eric hoffman}" }, { "entity": "chris granger|manual content block", "attribute": "is a", "value": "content block", "__id": "chris granger|manual content block|is a|content block" }, { "entity": "chris granger|manual content block", "attribute": "source", "value": "manual", "__id": "chris granger|manual content block|source|manual" }, { "entity": "chris granger|manual content block", "attribute": "associated entity", "value": "chris granger", "__id": "chris granger|manual content block|associated entity|chris granger" }, { "entity": "chris granger|manual content block", "attribute": "content", "value": "Chris Granger is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 2}.", "__id": "chris granger|manual content block|content|Chris Granger is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 2}." }, { "entity": "josh cole|manual content block", "attribute": "is a", "value": "content block", "__id": "josh cole|manual content block|is a|content block" }, { "entity": "josh cole|manual content block", "attribute": "source", "value": "manual", "__id": "josh cole|manual content block|source|manual" }, { "entity": "josh cole|manual content block", "attribute": "associated entity", "value": "josh cole", "__id": "josh cole|manual content block|associated entity|josh cole" }, { "entity": "josh cole|manual content block", "attribute": "content", "value": "Josh Cole is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 4}.", "__id": "josh cole|manual content block|content|Josh Cole is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 4}." }, { "entity": "jamie brandon|manual content block", "attribute": "is a", "value": "content block", "__id": "jamie brandon|manual content block|is a|content block" }, { "entity": "jamie brandon|manual content block", "attribute": "source", "value": "manual", "__id": "jamie brandon|manual content block|source|manual" }, { "entity": "jamie brandon|manual content block", "attribute": "associated entity", "value": "jamie brandon", "__id": "jamie brandon|manual content block|associated entity|jamie brandon" }, { "entity": "jamie brandon|manual content block", "attribute": "content", "value": "Jamie Brandon is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 4}.", "__id": "jamie brandon|manual content block|content|Jamie Brandon is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 4}." }, { "entity": "corey montella|manual content block", "attribute": "is a", "value": "content block", "__id": "corey montella|manual content block|is a|content block" }, { "entity": "corey montella|manual content block", "attribute": "source", "value": "manual", "__id": "corey montella|manual content block|source|manual" }, { "entity": "corey montella|manual content block", "attribute": "associated entity", "value": "corey montella", "__id": "corey montella|manual content block|associated entity|corey montella" }, { "entity": "corey montella|manual content block", "attribute": "content", "value": "Corey Montella is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 4}.", "__id": "corey montella|manual content block|content|Corey Montella is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 4}." }, { "entity": "eric hoffman|manual content block", "attribute": "is a", "value": "content block", "__id": "eric hoffman|manual content block|is a|content block" }, { "entity": "eric hoffman|manual content block", "attribute": "source", "value": "manual", "__id": "eric hoffman|manual content block|source|manual" }, { "entity": "eric hoffman|manual content block", "attribute": "associated entity", "value": "eric hoffman", "__id": "eric hoffman|manual content block|associated entity|eric hoffman" }, { "entity": "eric hoffman|manual content block", "attribute": "content", "value": "Eric Hoffman is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 4}.", "__id": "eric hoffman|manual content block|content|Eric Hoffman is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 4}." }, { "entity": "operations|manual content block", "attribute": "is a", "value": "content block", "__id": "operations|manual content block|is a|content block" }, { "entity": "operations|manual content block", "attribute": "source", "value": "manual", "__id": "operations|manual content block|source|manual" }, { "entity": "operations|manual content block", "attribute": "associated entity", "value": "operations", "__id": "operations|manual content block|associated entity|operations" }, { "entity": "operations|manual content block", "attribute": "content", "value": "Operations is a {is a: department} at {company: kodowa}, which includes:\n\n{robert attorri}", "__id": "operations|manual content block|content|Operations is a {is a: department} at {company: kodowa}, which includes:\n\n{robert attorri}" }, { "entity": "robert attorri|manual content block", "attribute": "is a", "value": "content block", "__id": "robert attorri|manual content block|is a|content block" }, { "entity": "robert attorri|manual content block", "attribute": "source", "value": "manual", "__id": "robert attorri|manual content block|source|manual" }, { "entity": "robert attorri|manual content block", "attribute": "associated entity", "value": "robert attorri", "__id": "robert attorri|manual content block|associated entity|robert attorri" }, { "entity": "robert attorri|manual content block", "attribute": "content", "value": "Robert Attorri is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 2}.", "__id": "robert attorri|manual content block|content|Robert Attorri is an {is a: employee} at {company: kodowa}.\nHis salary is {salary: 2}." }, { "entity": "modern family|manual content block", "attribute": "is a", "value": "content block", "__id": "modern family|manual content block|is a|content block" }, { "entity": "modern family|manual content block", "attribute": "source", "value": "manual", "__id": "modern family|manual content block|source|manual" }, { "entity": "modern family|manual content block", "attribute": "associated entity", "value": "modern family", "__id": "modern family|manual content block|associated entity|modern family" }, { "entity": "modern family|manual content block", "attribute": "content", "value": "Modern Family is an American television mockumentary that premiered on ABC on September 23, 2009, which follows the lives of Jay Pritchett and his family, all of whom live in suburban Los Angeles. Pritchett's family includes his second wife, his stepson, and infant son, as well as his two adult children and their spouses and children. Christopher Lloyd and Steven Levitan conceived the series while sharing stories of their own \"modern families\". Modern Family employs an ensemble cast. The series is presented in mockumentary style, with the fictional characters frequently talking directly into the camera. The series premiered on September 23, 2009 and was watched by 12.6 million viewers.\n\nSeason 1 Episodes\n1. {Pilot}\n2. {The Bicycle Thief}\n3. {Come Fly with Me}\n4. {The Incident}\n5. {Coal Digger}\n6. {Run for Your Wife}\n7. {En Garde}\n8. {Great Expectations}", "__id": "modern family|manual content block|content|Modern Family is an American television mockumentary that premiered on ABC on September 23, 2009, which follows the lives of Jay Pritchett and his family, all of whom live in suburban Los Angeles. Pritchett's family includes his second wife, his stepson, and infant son, as well as his two adult children and their spouses and children. Christopher Lloyd and Steven Levitan conceived the series while sharing stories of their own \"modern families\". Modern Family employs an ensemble cast. The series is presented in mockumentary style, with the fictional characters frequently talking directly into the camera. The series premiered on September 23, 2009 and was watched by 12.6 million viewers.\n\nSeason 1 Episodes\n1. {Pilot}\n2. {The Bicycle Thief}\n3. {Come Fly with Me}\n4. {The Incident}\n5. {Coal Digger}\n6. {Run for Your Wife}\n7. {En Garde}\n8. {Great Expectations}" }, { "entity": "great expectations|manual content block", "attribute": "is a", "value": "content block", "__id": "great expectations|manual content block|is a|content block" }, { "entity": "great expectations|manual content block", "attribute": "source", "value": "manual", "__id": "great expectations|manual content block|source|manual" }, { "entity": "great expectations|manual content block", "attribute": "associated entity", "value": "great expectations", "__id": "great expectations|manual content block|associated entity|great expectations" }, { "entity": "great expectations|manual content block", "attribute": "content", "value": "An {is a: episode} of {Modern Family} with {Edward Norton} in it.", "__id": "great expectations|manual content block|content|An {is a: episode} of {Modern Family} with {Edward Norton} in it." }, { "entity": "pilot|manual content block", "attribute": "is a", "value": "content block", "__id": "pilot|manual content block|is a|content block" }, { "entity": "pilot|manual content block", "attribute": "source", "value": "manual", "__id": "pilot|manual content block|source|manual" }, { "entity": "pilot|manual content block", "attribute": "associated entity", "value": "pilot", "__id": "pilot|manual content block|associated entity|pilot" }, { "entity": "pilot|manual content block", "attribute": "content", "value": "The first {is a: episode} of {modern family}.", "__id": "pilot|manual content block|content|The first {is a: episode} of {modern family}." }, { "entity": "the bicycle thief|manual content block", "attribute": "is a", "value": "content block", "__id": "the bicycle thief|manual content block|is a|content block" }, { "entity": "the bicycle thief|manual content block", "attribute": "source", "value": "manual", "__id": "the bicycle thief|manual content block|source|manual" }, { "entity": "the bicycle thief|manual content block", "attribute": "associated entity", "value": "the bicycle thief", "__id": "the bicycle thief|manual content block|associated entity|the bicycle thief" }, { "entity": "the bicycle thief|manual content block", "attribute": "content", "value": "The second {is a: episode} of {modern family}.", "__id": "the bicycle thief|manual content block|content|The second {is a: episode} of {modern family}." }, { "entity": "come fly with me|manual content block", "attribute": "is a", "value": "content block", "__id": "come fly with me|manual content block|is a|content block" }, { "entity": "come fly with me|manual content block", "attribute": "source", "value": "manual", "__id": "come fly with me|manual content block|source|manual" }, { "entity": "come fly with me|manual content block", "attribute": "associated entity", "value": "come fly with me", "__id": "come fly with me|manual content block|associated entity|come fly with me" }, { "entity": "come fly with me|manual content block", "attribute": "content", "value": "The third {is a: episode} of {modern family}.", "__id": "come fly with me|manual content block|content|The third {is a: episode} of {modern family}." }, { "entity": "the incident|manual content block", "attribute": "is a", "value": "content block", "__id": "the incident|manual content block|is a|content block" }, { "entity": "the incident|manual content block", "attribute": "source", "value": "manual", "__id": "the incident|manual content block|source|manual" }, { "entity": "the incident|manual content block", "attribute": "associated entity", "value": "the incident", "__id": "the incident|manual content block|associated entity|the incident" }, { "entity": "the incident|manual content block", "attribute": "content", "value": "The fourth {is a: episode} of {modern family}.", "__id": "the incident|manual content block|content|The fourth {is a: episode} of {modern family}." }, { "entity": "coal digger|manual content block", "attribute": "is a", "value": "content block", "__id": "coal digger|manual content block|is a|content block" }, { "entity": "coal digger|manual content block", "attribute": "source", "value": "manual", "__id": "coal digger|manual content block|source|manual" }, { "entity": "coal digger|manual content block", "attribute": "associated entity", "value": "coal digger", "__id": "coal digger|manual content block|associated entity|coal digger" }, { "entity": "coal digger|manual content block", "attribute": "content", "value": "The fifth {is a: episode} of {modern family}.", "__id": "coal digger|manual content block|content|The fifth {is a: episode} of {modern family}." }, { "entity": "run for your wife|manual content block", "attribute": "is a", "value": "content block", "__id": "run for your wife|manual content block|is a|content block" }, { "entity": "run for your wife|manual content block", "attribute": "source", "value": "manual", "__id": "run for your wife|manual content block|source|manual" }, { "entity": "run for your wife|manual content block", "attribute": "associated entity", "value": "run for your wife", "__id": "run for your wife|manual content block|associated entity|run for your wife" }, { "entity": "run for your wife|manual content block", "attribute": "content", "value": "The sixth {is a: episode} of {modern family}.", "__id": "run for your wife|manual content block|content|The sixth {is a: episode} of {modern family}." }, { "entity": "en garde|manual content block", "attribute": "is a", "value": "content block", "__id": "en garde|manual content block|is a|content block" }, { "entity": "en garde|manual content block", "attribute": "source", "value": "manual", "__id": "en garde|manual content block|source|manual" }, { "entity": "en garde|manual content block", "attribute": "associated entity", "value": "en garde", "__id": "en garde|manual content block|associated entity|en garde" }, { "entity": "en garde|manual content block", "attribute": "content", "value": "The seventh {is a: episode} of {modern family}.", "__id": "en garde|manual content block|content|The seventh {is a: episode} of {modern family}." }, { "entity": "edward norton|manual content block", "attribute": "is a", "value": "content block", "__id": "edward norton|manual content block|is a|content block" }, { "entity": "edward norton|manual content block", "attribute": "source", "value": "manual", "__id": "edward norton|manual content block|source|manual" }, { "entity": "edward norton|manual content block", "attribute": "associated entity", "value": "edward norton", "__id": "edward norton|manual content block|associated entity|edward norton" }, { "entity": "edward norton|manual content block", "attribute": "content", "value": "Edward Harrison Norton (born August 18, 1969) is an {is a: American} {is a: actor}, filmmaker and activist. He was nominated for three Academy Awards for his work in the films Primal Fear (1996), American History X (1998) and Birdman (2014). He also starred in other roles, such as Everyone Says I Love You (1996), The People vs. Larry Flynt (1996), Fight Club (1999), Red Dragon (2002), 25th Hour (2002), Kingdom of Heaven (2005), The Illusionist (2006), Moonrise Kingdom (2012) and The Grand Budapest Hotel (2014). He has also directed and co-written films, including his directorial debut, Keeping the Faith (2000). He has done uncredited work on the scripts for The Score, Frida and The Incredible Hulk.\n\nHe is {age: 46} years old.", "__id": "edward norton|manual content block|content|Edward Harrison Norton (born August 18, 1969) is an {is a: American} {is a: actor}, filmmaker and activist. He was nominated for three Academy Awards for his work in the films Primal Fear (1996), American History X (1998) and Birdman (2014). He also starred in other roles, such as Everyone Says I Love You (1996), The People vs. Larry Flynt (1996), Fight Club (1999), Red Dragon (2002), 25th Hour (2002), Kingdom of Heaven (2005), The Illusionist (2006), Moonrise Kingdom (2012) and The Grand Budapest Hotel (2014). He has also directed and co-written films, including his directorial debut, Keeping the Faith (2000). He has done uncredited work on the scripts for The Score, Frida and The Incredible Hulk.\n\nHe is {age: 46} years old." }, { "entity": "vin diesel|manual content block", "attribute": "is a", "value": "content block", "__id": "vin diesel|manual content block|is a|content block" }, { "entity": "vin diesel|manual content block", "attribute": "source", "value": "manual", "__id": "vin diesel|manual content block|source|manual" }, { "entity": "vin diesel|manual content block", "attribute": "associated entity", "value": "vin diesel", "__id": "vin diesel|manual content block|associated entity|vin diesel" }, { "entity": "vin diesel|manual content block", "attribute": "content", "value": "Mark Sinclair (born July 18, 1967), better known by his stage name Vin Diesel, is an {is a: American} {is a: actor}. He is best known for his portrayals of Dominic Toretto in The Fast and the Furious film series and Richard B. Riddick in The Chronicles of Riddick trilogy. He also was a producer on sequels in both franchises.\nDiesel has also starred in films such as xXx (2002) and Find Me Guilty (2006). His voice acting work includes The Iron Giant (1999), the video game spin-offs from The Chronicles of Riddick franchise, and Guardians of the Galaxy (2014). He wrote, directed, produced, and starred in a short film titled Multi-Facial and the feature-length drama film Strays. He is the founder of the production companies One Race Films, Racetrack Records, and Tigon Studios.", "__id": "vin diesel|manual content block|content|Mark Sinclair (born July 18, 1967), better known by his stage name Vin Diesel, is an {is a: American} {is a: actor}. He is best known for his portrayals of Dominic Toretto in The Fast and the Furious film series and Richard B. Riddick in The Chronicles of Riddick trilogy. He also was a producer on sequels in both franchises.\nDiesel has also starred in films such as xXx (2002) and Find Me Guilty (2006). His voice acting work includes The Iron Giant (1999), the video game spin-offs from The Chronicles of Riddick franchise, and Guardians of the Galaxy (2014). He wrote, directed, produced, and starred in a short film titled Multi-Facial and the feature-length drama film Strays. He is the founder of the production companies One Race Films, Racetrack Records, and Tigon Studios." }, { "entity": "oyako don|manual content block", "attribute": "is a", "value": "content block", "__id": "oyako don|manual content block|is a|content block" }, { "entity": "oyako don|manual content block", "attribute": "source", "value": "manual", "__id": "oyako don|manual content block|source|manual" }, { "entity": "oyako don|manual content block", "attribute": "associated entity", "value": "oyako don", "__id": "oyako don|manual content block|associated entity|oyako don" }, { "entity": "oyako don|manual content block", "attribute": "content", "value": "Oyakodon (親子丼), literally 'parent-and-child donburi', is a donburi, or Japanese rice bowl dish, in which {chicken}, {egg}, sliced {scallion} (or sometimes regular onions), and other ingredients are all simmered together in a sauce and then served on top of a large bowl of {rice}. The name of the dish is a poetic reflection of the fact that both {chicken} and {egg} are used in the {is a: dish}.\n\nOyako don is typically {is a: savory}.", "__id": "oyako don|manual content block|content|Oyakodon (親子丼), literally 'parent-and-child donburi', is a donburi, or Japanese rice bowl dish, in which {chicken}, {egg}, sliced {scallion} (or sometimes regular onions), and other ingredients are all simmered together in a sauce and then served on top of a large bowl of {rice}. The name of the dish is a poetic reflection of the fact that both {chicken} and {egg} are used in the {is a: dish}.\n\nOyako don is typically {is a: savory}." }, { "entity": "chicken|manual content block", "attribute": "is a", "value": "content block", "__id": "chicken|manual content block|is a|content block" }, { "entity": "chicken|manual content block", "attribute": "source", "value": "manual", "__id": "chicken|manual content block|source|manual" }, { "entity": "chicken|manual content block", "attribute": "associated entity", "value": "chicken", "__id": "chicken|manual content block|associated entity|chicken" }, { "entity": "chicken|manual content block", "attribute": "content", "value": "Chicken is a {is a: meat} used as an {is a: ingredient}.", "__id": "chicken|manual content block|content|Chicken is a {is a: meat} used as an {is a: ingredient}." }, { "entity": "egg|manual content block", "attribute": "is a", "value": "content block", "__id": "egg|manual content block|is a|content block" }, { "entity": "egg|manual content block", "attribute": "source", "value": "manual", "__id": "egg|manual content block|source|manual" }, { "entity": "egg|manual content block", "attribute": "associated entity", "value": "egg", "__id": "egg|manual content block|associated entity|egg" }, { "entity": "egg|manual content block", "attribute": "content", "value": "Is an {is a: ingredient}.", "__id": "egg|manual content block|content|Is an {is a: ingredient}." }, { "entity": "rice|manual content block", "attribute": "is a", "value": "content block", "__id": "rice|manual content block|is a|content block" }, { "entity": "rice|manual content block", "attribute": "source", "value": "manual", "__id": "rice|manual content block|source|manual" }, { "entity": "rice|manual content block", "attribute": "associated entity", "value": "rice", "__id": "rice|manual content block|associated entity|rice" }, { "entity": "rice|manual content block", "attribute": "content", "value": "Rice is a {is a: grain} used as an {is a: ingredient} in virtually every kind of cuisine.", "__id": "rice|manual content block|content|Rice is a {is a: grain} used as an {is a: ingredient} in virtually every kind of cuisine." }, { "entity": "scallion|manual content block", "attribute": "is a", "value": "content block", "__id": "scallion|manual content block|is a|content block" }, { "entity": "scallion|manual content block", "attribute": "source", "value": "manual", "__id": "scallion|manual content block|source|manual" }, { "entity": "scallion|manual content block", "attribute": "associated entity", "value": "scallion", "__id": "scallion|manual content block|associated entity|scallion" }, { "entity": "scallion|manual content block", "attribute": "content", "value": "Also known as 'green onion,' scalions are a {is a: vegetable} used as an {is a: ingredient}.", "__id": "scallion|manual content block|content|Also known as 'green onion,' scalions are a {is a: vegetable} used as an {is a: ingredient}." }, { "entity": "apple pie|manual content block", "attribute": "is a", "value": "content block", "__id": "apple pie|manual content block|is a|content block" }, { "entity": "apple pie|manual content block", "attribute": "source", "value": "manual", "__id": "apple pie|manual content block|source|manual" }, { "entity": "apple pie|manual content block", "attribute": "associated entity", "value": "apple pie", "__id": "apple pie|manual content block|associated entity|apple pie" }, { "entity": "apple pie|manual content block", "attribute": "content", "value": "An apple pie is a fruit {is a: pie} in which the principal filling ingredient is {apple}. It is, on occasion, served with {whipped cream} or {ice cream} on top, or alongside {cheddar cheese}. The {is a: pastry} is generally used top-and-bottom, making it a double-crust pie, the upper crust of which may be a circular shaped crust or a pastry lattice woven of strips; exceptions are deep-dish apple pie with a top crust only, and open-face {Tarte Tatin}.\n\nApple pie is typically a {is a: sweet} {is a: dish} and is served as {is a: dessert}.", "__id": "apple pie|manual content block|content|An apple pie is a fruit {is a: pie} in which the principal filling ingredient is {apple}. It is, on occasion, served with {whipped cream} or {ice cream} on top, or alongside {cheddar cheese}. The {is a: pastry} is generally used top-and-bottom, making it a double-crust pie, the upper crust of which may be a circular shaped crust or a pastry lattice woven of strips; exceptions are deep-dish apple pie with a top crust only, and open-face {Tarte Tatin}.\n\nApple pie is typically a {is a: sweet} {is a: dish} and is served as {is a: dessert}." }, { "entity": "apple|manual content block", "attribute": "is a", "value": "content block", "__id": "apple|manual content block|is a|content block" }, { "entity": "apple|manual content block", "attribute": "source", "value": "manual", "__id": "apple|manual content block|source|manual" }, { "entity": "apple|manual content block", "attribute": "associated entity", "value": "apple", "__id": "apple|manual content block|associated entity|apple" }, { "entity": "apple|manual content block", "attribute": "content", "value": "Is a {is a: fruit} and {is a: ingredient}", "__id": "apple|manual content block|content|Is a {is a: fruit} and {is a: ingredient}" }, { "entity": "my collection|manual content block", "attribute": "is a", "value": "content block", "__id": "my collection|manual content block|is a|content block" }, { "entity": "my collection|manual content block", "attribute": "source", "value": "manual", "__id": "my collection|manual content block|source|manual" }, { "entity": "my collection|manual content block", "attribute": "associated entity", "value": "my collection", "__id": "my collection|manual content block|associated entity|my collection" }, { "entity": "my collection|manual content block", "attribute": "content", "value": "Dishes: {oyako don}, {apple pie}", "__id": "my collection|manual content block|content|Dishes: {oyako don}, {apple pie}" }, { "entity": "kodowa|manual content block", "attribute": "is a", "value": "content block", "__id": "kodowa|manual content block|is a|content block" }, { "entity": "kodowa|manual content block", "attribute": "source", "value": "manual", "__id": "kodowa|manual content block|source|manual" }, { "entity": "kodowa|manual content block", "attribute": "associated entity", "value": "kodowa", "__id": "kodowa|manual content block|associated entity|kodowa" }, { "entity": "kodowa|manual content block", "attribute": "content", "value": "The company behind {Eve}.", "__id": "kodowa|manual content block|content|The company behind {Eve}." }, { "entity": "manual entity|manual content block", "attribute": "is a", "value": "content block", "__id": "manual entity|manual content block|is a|content block" }, { "entity": "manual entity|manual content block", "attribute": "source", "value": "manual", "__id": "manual entity|manual content block|source|manual" }, { "entity": "manual entity|manual content block", "attribute": "associated entity", "value": "manual entity", "__id": "manual entity|manual content block|associated entity|manual entity" }, { "entity": "manual entity|manual content block", "attribute": "content", "value": "# manual entity\nManual Entity is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* content\n", "__id": "manual entity|manual content block|content|# manual entity\nManual Entity is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* content\n" }, { "entity": "manual eav|manual content block", "attribute": "is a", "value": "content block", "__id": "manual eav|manual content block|is a|content block" }, { "entity": "manual eav|manual content block", "attribute": "source", "value": "manual", "__id": "manual eav|manual content block|source|manual" }, { "entity": "manual eav|manual content block", "attribute": "associated entity", "value": "manual eav", "__id": "manual eav|manual content block|associated entity|manual eav" }, { "entity": "manual eav|manual content block", "attribute": "content", "value": "# manual eav\nManual Eav is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* attribute\n* value\n", "__id": "manual eav|manual content block|content|# manual eav\nManual Eav is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* attribute\n* value\n" }, { "entity": "action entity|manual content block", "attribute": "is a", "value": "content block", "__id": "action entity|manual content block|is a|content block" }, { "entity": "action entity|manual content block", "attribute": "source", "value": "manual", "__id": "action entity|manual content block|source|manual" }, { "entity": "action entity|manual content block", "attribute": "associated entity", "value": "action entity", "__id": "action entity|manual content block|associated entity|action entity" }, { "entity": "action entity|manual content block", "attribute": "content", "value": "# action entity\nAction Entity is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* content\n* source\n", "__id": "action entity|manual content block|content|# action entity\nAction Entity is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* content\n* source\n" }, { "entity": "collection|manual content block", "attribute": "is a", "value": "content block", "__id": "collection|manual content block|is a|content block" }, { "entity": "collection|manual content block", "attribute": "source", "value": "manual", "__id": "collection|manual content block|source|manual" }, { "entity": "collection|manual content block", "attribute": "associated entity", "value": "collection", "__id": "collection|manual content block|associated entity|collection" }, { "entity": "collection|manual content block", "attribute": "content", "value": "# collection\nCollection is a   {is a: system}.\n", "__id": "collection|manual content block|content|# collection\nCollection is a   {is a: system}.\n" }, { "entity": "system|manual content block", "attribute": "is a", "value": "content block", "__id": "system|manual content block|is a|content block" }, { "entity": "system|manual content block", "attribute": "source", "value": "manual", "__id": "system|manual content block|source|manual" }, { "entity": "system|manual content block", "attribute": "associated entity", "value": "system", "__id": "system|manual content block|associated entity|system" }, { "entity": "system|manual content block", "attribute": "content", "value": "# system\nSystem is a   {is a: collection}.\n", "__id": "system|manual content block|content|# system\nSystem is a   {is a: collection}.\n" }, { "entity": "union|manual content block", "attribute": "is a", "value": "content block", "__id": "union|manual content block|is a|content block" }, { "entity": "union|manual content block", "attribute": "source", "value": "manual", "__id": "union|manual content block|source|manual" }, { "entity": "union|manual content block", "attribute": "associated entity", "value": "union", "__id": "union|manual content block|associated entity|union" }, { "entity": "union|manual content block", "attribute": "content", "value": "# union\nUnion is a {is a: system} and {is a: collection}.\n", "__id": "union|manual content block|content|# union\nUnion is a {is a: system} and {is a: collection}.\n" }, { "entity": "query|manual content block", "attribute": "is a", "value": "content block", "__id": "query|manual content block|is a|content block" }, { "entity": "query|manual content block", "attribute": "source", "value": "manual", "__id": "query|manual content block|source|manual" }, { "entity": "query|manual content block", "attribute": "associated entity", "value": "query", "__id": "query|manual content block|associated entity|query" }, { "entity": "query|manual content block", "attribute": "content", "value": "# query\nQuery is a {is a: system} and {is a: collection}.\n", "__id": "query|manual content block|content|# query\nQuery is a {is a: system} and {is a: collection}.\n" }, { "entity": "table|manual content block", "attribute": "is a", "value": "content block", "__id": "table|manual content block|is a|content block" }, { "entity": "table|manual content block", "attribute": "source", "value": "manual", "__id": "table|manual content block|source|manual" }, { "entity": "table|manual content block", "attribute": "associated entity", "value": "table", "__id": "table|manual content block|associated entity|table" }, { "entity": "table|manual content block", "attribute": "content", "value": "# table\nTable is a {is a: system} and {is a: collection}.\n", "__id": "table|manual content block|content|# table\nTable is a {is a: system} and {is a: collection}.\n" }, { "entity": "ui|manual content block", "attribute": "is a", "value": "content block", "__id": "ui|manual content block|is a|content block" }, { "entity": "ui|manual content block", "attribute": "source", "value": "manual", "__id": "ui|manual content block|source|manual" }, { "entity": "ui|manual content block", "attribute": "associated entity", "value": "ui", "__id": "ui|manual content block|associated entity|ui" }, { "entity": "ui|manual content block", "attribute": "content", "value": "# ui\nUi is a {is a: system} and {is a: collection}.\n", "__id": "ui|manual content block|content|# ui\nUi is a {is a: system} and {is a: collection}.\n" }, { "entity": "entity|manual content block", "attribute": "is a", "value": "content block", "__id": "entity|manual content block|is a|content block" }, { "entity": "entity|manual content block", "attribute": "source", "value": "manual", "__id": "entity|manual content block|source|manual" }, { "entity": "entity|manual content block", "attribute": "associated entity", "value": "entity", "__id": "entity|manual content block|associated entity|entity" }, { "entity": "entity|manual content block", "attribute": "content", "value": "# entity\nEntity is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* content\n", "__id": "entity|manual content block|content|# entity\nEntity is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* content\n" }, { "entity": "unmodified added bits|manual content block", "attribute": "is a", "value": "content block", "__id": "unmodified added bits|manual content block|is a|content block" }, { "entity": "unmodified added bits|manual content block", "attribute": "source", "value": "manual", "__id": "unmodified added bits|manual content block|source|manual" }, { "entity": "unmodified added bits|manual content block", "attribute": "associated entity", "value": "unmodified added bits", "__id": "unmodified added bits|manual content block|associated entity|unmodified added bits" }, { "entity": "unmodified added bits|manual content block", "attribute": "content", "value": "# unmodified added bits\nUnmodified Added Bits is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* content\n", "__id": "unmodified added bits|manual content block|content|# unmodified added bits\nUnmodified Added Bits is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* content\n" }, { "entity": "content blocks|manual content block", "attribute": "is a", "value": "content block", "__id": "content blocks|manual content block|is a|content block" }, { "entity": "content blocks|manual content block", "attribute": "source", "value": "manual", "__id": "content blocks|manual content block|source|manual" }, { "entity": "content blocks|manual content block", "attribute": "associated entity", "value": "content blocks", "__id": "content blocks|manual content block|associated entity|content blocks" }, { "entity": "content blocks|manual content block", "attribute": "content", "value": "# content blocks\nContent Blocks is a {is a: system} and {is a: query}.\n\n## Fields\n* block\n* entity\n* content\n", "__id": "content blocks|manual content block|content|# content blocks\nContent Blocks is a {is a: system} and {is a: query}.\n\n## Fields\n* block\n* entity\n* content\n" }, { "entity": "parsed content blocks|manual content block", "attribute": "is a", "value": "content block", "__id": "parsed content blocks|manual content block|is a|content block" }, { "entity": "parsed content blocks|manual content block", "attribute": "source", "value": "manual", "__id": "parsed content blocks|manual content block|source|manual" }, { "entity": "parsed content blocks|manual content block", "attribute": "associated entity", "value": "parsed content blocks", "__id": "parsed content blocks|manual content block|associated entity|parsed content blocks" }, { "entity": "parsed content blocks|manual content block", "attribute": "content", "value": "# parsed content blocks\nParsed Content Blocks is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* attribute\n* value\n", "__id": "parsed content blocks|manual content block|content|# parsed content blocks\nParsed Content Blocks is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* attribute\n* value\n" }, { "entity": "parsed eavs|manual content block", "attribute": "is a", "value": "content block", "__id": "parsed eavs|manual content block|is a|content block" }, { "entity": "parsed eavs|manual content block", "attribute": "source", "value": "manual", "__id": "parsed eavs|manual content block|source|manual" }, { "entity": "parsed eavs|manual content block", "attribute": "associated entity", "value": "parsed eavs", "__id": "parsed eavs|manual content block|associated entity|parsed eavs" }, { "entity": "parsed eavs|manual content block", "attribute": "content", "value": "# parsed eavs\nParsed Eavs is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* attribute\n* value\n", "__id": "parsed eavs|manual content block|content|# parsed eavs\nParsed Eavs is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* attribute\n* value\n" }, { "entity": "entity eavs|manual content block", "attribute": "is a", "value": "content block", "__id": "entity eavs|manual content block|is a|content block" }, { "entity": "entity eavs|manual content block", "attribute": "source", "value": "manual", "__id": "entity eavs|manual content block|source|manual" }, { "entity": "entity eavs|manual content block", "attribute": "associated entity", "value": "entity eavs", "__id": "entity eavs|manual content block|associated entity|entity eavs" }, { "entity": "entity eavs|manual content block", "attribute": "content", "value": "# entity eavs\nEntity Eavs is a {is a: system} and {is a: union}.\n\n## Fields\n* entity\n* attribute\n* value\n", "__id": "entity eavs|manual content block|content|# entity eavs\nEntity Eavs is a {is a: system} and {is a: union}.\n\n## Fields\n* entity\n* attribute\n* value\n" }, { "entity": "builtin entity eavs|manual content block", "attribute": "is a", "value": "content block", "__id": "builtin entity eavs|manual content block|is a|content block" }, { "entity": "builtin entity eavs|manual content block", "attribute": "source", "value": "manual", "__id": "builtin entity eavs|manual content block|source|manual" }, { "entity": "builtin entity eavs|manual content block", "attribute": "associated entity", "value": "builtin entity eavs", "__id": "builtin entity eavs|manual content block|associated entity|builtin entity eavs" }, { "entity": "builtin entity eavs|manual content block", "attribute": "content", "value": "# builtin entity eavs\nBuiltin Entity Eavs is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* attribute\n* value\n", "__id": "builtin entity eavs|manual content block|content|# builtin entity eavs\nBuiltin Entity Eavs is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* attribute\n* value\n" }, { "entity": "is a attributes|manual content block", "attribute": "is a", "value": "content block", "__id": "is a attributes|manual content block|is a|content block" }, { "entity": "is a attributes|manual content block", "attribute": "source", "value": "manual", "__id": "is a attributes|manual content block|source|manual" }, { "entity": "is a attributes|manual content block", "attribute": "associated entity", "value": "is a attributes", "__id": "is a attributes|manual content block|associated entity|is a attributes" }, { "entity": "is a attributes|manual content block", "attribute": "content", "value": "# is a attributes\nIs A Attributes is a {is a: system} and {is a: query}.\n\n## Fields\n* collection\n* entity\n", "__id": "is a attributes|manual content block|content|# is a attributes\nIs A Attributes is a {is a: system} and {is a: query}.\n\n## Fields\n* collection\n* entity\n" }, { "entity": "lowercase eavs|manual content block", "attribute": "is a", "value": "content block", "__id": "lowercase eavs|manual content block|is a|content block" }, { "entity": "lowercase eavs|manual content block", "attribute": "source", "value": "manual", "__id": "lowercase eavs|manual content block|source|manual" }, { "entity": "lowercase eavs|manual content block", "attribute": "associated entity", "value": "lowercase eavs", "__id": "lowercase eavs|manual content block|associated entity|lowercase eavs" }, { "entity": "lowercase eavs|manual content block", "attribute": "content", "value": "# lowercase eavs\nLowercase Eavs is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* attribute\n* value\n", "__id": "lowercase eavs|manual content block|content|# lowercase eavs\nLowercase Eavs is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* attribute\n* value\n" }, { "entity": "eav entity links|manual content block", "attribute": "is a", "value": "content block", "__id": "eav entity links|manual content block|is a|content block" }, { "entity": "eav entity links|manual content block", "attribute": "source", "value": "manual", "__id": "eav entity links|manual content block|source|manual" }, { "entity": "eav entity links|manual content block", "attribute": "associated entity", "value": "eav entity links", "__id": "eav entity links|manual content block|associated entity|eav entity links" }, { "entity": "eav entity links|manual content block", "attribute": "content", "value": "# eav entity links\nEav Entity Links is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* link\n* type\n", "__id": "eav entity links|manual content block|content|# eav entity links\nEav Entity Links is a {is a: system} and {is a: query}.\n\n## Fields\n* entity\n* link\n* type\n" }, { "entity": "entity links|manual content block", "attribute": "is a", "value": "content block", "__id": "entity links|manual content block|is a|content block" }, { "entity": "entity links|manual content block", "attribute": "source", "value": "manual", "__id": "entity links|manual content block|source|manual" }, { "entity": "entity links|manual content block", "attribute": "associated entity", "value": "entity links", "__id": "entity links|manual content block|associated entity|entity links" }, { "entity": "entity links|manual content block", "attribute": "content", "value": "# entity links\nEntity Links is a {is a: system} and {is a: union}.\n\n## Fields\n* entity\n* link\n* type\n", "__id": "entity links|manual content block|content|# entity links\nEntity Links is a {is a: system} and {is a: union}.\n\n## Fields\n* entity\n* link\n* type\n" }, { "entity": "builtin entity links|manual content block", "attribute": "is a", "value": "content block", "__id": "builtin entity links|manual content block|is a|content block" }, { "entity": "builtin entity links|manual content block", "attribute": "source", "value": "manual", "__id": "builtin entity links|manual content block|source|manual" }, { "entity": "builtin entity links|manual content block", "attribute": "associated entity", "value": "builtin entity links", "__id": "builtin entity links|manual content block|associated entity|builtin entity links" }, { "entity": "builtin entity links|manual content block", "attribute": "content", "value": "# builtin entity links\nBuiltin Entity Links is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* link\n* type\n", "__id": "builtin entity links|manual content block|content|# builtin entity links\nBuiltin Entity Links is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* link\n* type\n" }, { "entity": "directionless links|manual content block", "attribute": "is a", "value": "content block", "__id": "directionless links|manual content block|is a|content block" }, { "entity": "directionless links|manual content block", "attribute": "source", "value": "manual", "__id": "directionless links|manual content block|source|manual" }, { "entity": "directionless links|manual content block", "attribute": "associated entity", "value": "directionless links", "__id": "directionless links|manual content block|associated entity|directionless links" }, { "entity": "directionless links|manual content block", "attribute": "content", "value": "# directionless links\nDirectionless Links is a {is a: system} and {is a: union}.\n\n## Fields\n* entity\n* link\n", "__id": "directionless links|manual content block|content|# directionless links\nDirectionless Links is a {is a: system} and {is a: union}.\n\n## Fields\n* entity\n* link\n" }, { "entity": "builtin directionless links|manual content block", "attribute": "is a", "value": "content block", "__id": "builtin directionless links|manual content block|is a|content block" }, { "entity": "builtin directionless links|manual content block", "attribute": "source", "value": "manual", "__id": "builtin directionless links|manual content block|source|manual" }, { "entity": "builtin directionless links|manual content block", "attribute": "associated entity", "value": "builtin directionless links", "__id": "builtin directionless links|manual content block|associated entity|builtin directionless links" }, { "entity": "builtin directionless links|manual content block", "attribute": "content", "value": "# builtin directionless links\nBuiltin Directionless Links is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* link\n", "__id": "builtin directionless links|manual content block|content|# builtin directionless links\nBuiltin Directionless Links is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* link\n" }, { "entity": "collection entities|manual content block", "attribute": "is a", "value": "content block", "__id": "collection entities|manual content block|is a|content block" }, { "entity": "collection entities|manual content block", "attribute": "source", "value": "manual", "__id": "collection entities|manual content block|source|manual" }, { "entity": "collection entities|manual content block", "attribute": "associated entity", "value": "collection entities", "__id": "collection entities|manual content block|associated entity|collection entities" }, { "entity": "collection entities|manual content block", "attribute": "content", "value": "# collection entities\nCollection Entities is a {is a: system} and {is a: union}.\n\n## Fields\n* entity\n* collection\n", "__id": "collection entities|manual content block|content|# collection entities\nCollection Entities is a {is a: system} and {is a: union}.\n\n## Fields\n* entity\n* collection\n" }, { "entity": "builtin collection entities|manual content block", "attribute": "is a", "value": "content block", "__id": "builtin collection entities|manual content block|is a|content block" }, { "entity": "builtin collection entities|manual content block", "attribute": "source", "value": "manual", "__id": "builtin collection entities|manual content block|source|manual" }, { "entity": "builtin collection entities|manual content block", "attribute": "associated entity", "value": "builtin collection entities", "__id": "builtin collection entities|manual content block|associated entity|builtin collection entities" }, { "entity": "builtin collection entities|manual content block", "attribute": "content", "value": "# builtin collection entities\nBuiltin Collection Entities is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* collection\n", "__id": "builtin collection entities|manual content block|content|# builtin collection entities\nBuiltin Collection Entities is a {is a: system} and {is a: table}.\n\n## Fields\n* entity\n* collection\n" }, { "entity": "collection|manual content block", "attribute": "content", "value": "# collection\nCollection is a {is a: system} and {is a: query}.\n\n## Fields\n* collection\n* count\n", "__id": "collection|manual content block|content|# collection\nCollection is a {is a: system} and {is a: query}.\n\n## Fields\n* collection\n* count\n" }, { "entity": "search|manual content block", "attribute": "is a", "value": "content block", "__id": "search|manual content block|is a|content block" }, { "entity": "search|manual content block", "attribute": "source", "value": "manual", "__id": "search|manual content block|source|manual" }, { "entity": "search|manual content block", "attribute": "associated entity", "value": "search", "__id": "search|manual content block|associated entity|search" }, { "entity": "search|manual content block", "attribute": "content", "value": "# search\nSearch is a {is a: system} and {is a: union}.\n\n## Fields\n* id\n* top\n* left\n", "__id": "search|manual content block|content|# search\nSearch is a {is a: system} and {is a: union}.\n\n## Fields\n* id\n* top\n* left\n" }, { "entity": "builtin search|manual content block", "attribute": "is a", "value": "content block", "__id": "builtin search|manual content block|is a|content block" }, { "entity": "builtin search|manual content block", "attribute": "source", "value": "manual", "__id": "builtin search|manual content block|source|manual" }, { "entity": "builtin search|manual content block", "attribute": "associated entity", "value": "builtin search", "__id": "builtin search|manual content block|associated entity|builtin search" }, { "entity": "builtin search|manual content block", "attribute": "content", "value": "# builtin search\nBuiltin Search is a {is a: system} and {is a: table}.\n\n## Fields\n* id\n* top\n* left\n", "__id": "builtin search|manual content block|content|# builtin search\nBuiltin Search is a {is a: system} and {is a: table}.\n\n## Fields\n* id\n* top\n* left\n" }, { "entity": "search query|manual content block", "attribute": "is a", "value": "content block", "__id": "search query|manual content block|is a|content block" }, { "entity": "search query|manual content block", "attribute": "source", "value": "manual", "__id": "search query|manual content block|source|manual" }, { "entity": "search query|manual content block", "attribute": "associated entity", "value": "search query", "__id": "search query|manual content block|associated entity|search query" }, { "entity": "search query|manual content block", "attribute": "content", "value": "# search query\nSearch Query is a {is a: system} and {is a: union}.\n\n## Fields\n* id\n* search\n", "__id": "search query|manual content block|content|# search query\nSearch Query is a {is a: system} and {is a: union}.\n\n## Fields\n* id\n* search\n" }, { "entity": "builtin search query|manual content block", "attribute": "is a", "value": "content block", "__id": "builtin search query|manual content block|is a|content block" }, { "entity": "builtin search query|manual content block", "attribute": "source", "value": "manual", "__id": "builtin search query|manual content block|source|manual" }, { "entity": "builtin search query|manual content block", "attribute": "associated entity", "value": "builtin search query", "__id": "builtin search query|manual content block|associated entity|builtin search query" }, { "entity": "builtin search query|manual content block", "attribute": "content", "value": "# builtin search query\nBuiltin Search Query is a {is a: system} and {is a: table}.\n\n## Fields\n* id\n* search\n", "__id": "builtin search query|manual content block|content|# builtin search query\nBuiltin Search Query is a {is a: system} and {is a: table}.\n\n## Fields\n* id\n* search\n" }, { "entity": "ui template|manual content block", "attribute": "is a", "value": "content block", "__id": "ui template|manual content block|is a|content block" }, { "entity": "ui template|manual content block", "attribute": "source", "value": "manual", "__id": "ui template|manual content block|source|manual" }, { "entity": "ui template|manual content block", "attribute": "associated entity", "value": "ui template", "__id": "ui template|manual content block|associated entity|ui template" }, { "entity": "ui template|manual content block", "attribute": "content", "value": "# ui template\nUi Template is a {is a: system} and {is a: table}.\n\n## Fields\n* ui template: template\n* ui template: parent\n* ui template: ix\n", "__id": "ui template|manual content block|content|# ui template\nUi Template is a {is a: system} and {is a: table}.\n\n## Fields\n* ui template: template\n* ui template: parent\n* ui template: ix\n" }, { "entity": "ui template binding|manual content block", "attribute": "is a", "value": "content block", "__id": "ui template binding|manual content block|is a|content block" }, { "entity": "ui template binding|manual content block", "attribute": "source", "value": "manual", "__id": "ui template binding|manual content block|source|manual" }, { "entity": "ui template binding|manual content block", "attribute": "associated entity", "value": "ui template binding", "__id": "ui template binding|manual content block|associated entity|ui template binding" }, { "entity": "ui template binding|manual content block", "attribute": "content", "value": "# ui template binding\nUi Template Binding is a {is a: system} and {is a: table}.\n\n## Fields\n* ui template binding: template\n* ui template binding: query\n", "__id": "ui template binding|manual content block|content|# ui template binding\nUi Template Binding is a {is a: system} and {is a: table}.\n\n## Fields\n* ui template binding: template\n* ui template binding: query\n" }, { "entity": "ui embed|manual content block", "attribute": "is a", "value": "content block", "__id": "ui embed|manual content block|is a|content block" }, { "entity": "ui embed|manual content block", "attribute": "source", "value": "manual", "__id": "ui embed|manual content block|source|manual" }, { "entity": "ui embed|manual content block", "attribute": "associated entity", "value": "ui embed", "__id": "ui embed|manual content block|associated entity|ui embed" }, { "entity": "ui embed|manual content block", "attribute": "content", "value": "# ui embed\nUi Embed is a {is a: system} and {is a: table}.\n\n## Fields\n* ui embed: embed\n* ui embed: template\n* ui embed: parent\n* ui embed: ix\n", "__id": "ui embed|manual content block|content|# ui embed\nUi Embed is a {is a: system} and {is a: table}.\n\n## Fields\n* ui embed: embed\n* ui embed: template\n* ui embed: parent\n* ui embed: ix\n" }, { "entity": "ui embed scope|manual content block", "attribute": "is a", "value": "content block", "__id": "ui embed scope|manual content block|is a|content block" }, { "entity": "ui embed scope|manual content block", "attribute": "source", "value": "manual", "__id": "ui embed scope|manual content block|source|manual" }, { "entity": "ui embed scope|manual content block", "attribute": "associated entity", "value": "ui embed scope", "__id": "ui embed scope|manual content block|associated entity|ui embed scope" }, { "entity": "ui embed scope|manual content block", "attribute": "content", "value": "# ui embed scope\nUi Embed Scope is a {is a: system} and {is a: table}.\n\n## Fields\n* ui embed scope: embed\n* ui embed scope: key\n* ui embed scope: value\n", "__id": "ui embed scope|manual content block|content|# ui embed scope\nUi Embed Scope is a {is a: system} and {is a: table}.\n\n## Fields\n* ui embed scope: embed\n* ui embed scope: key\n* ui embed scope: value\n" }, { "entity": "ui embed scope binding|manual content block", "attribute": "is a", "value": "content block", "__id": "ui embed scope binding|manual content block|is a|content block" }, { "entity": "ui embed scope binding|manual content block", "attribute": "source", "value": "manual", "__id": "ui embed scope binding|manual content block|source|manual" }, { "entity": "ui embed scope binding|manual content block", "attribute": "associated entity", "value": "ui embed scope binding", "__id": "ui embed scope binding|manual content block|associated entity|ui embed scope binding" }, { "entity": "ui embed scope binding|manual content block", "attribute": "content", "value": "# ui embed scope binding\nUi Embed Scope Binding is a {is a: system} and {is a: table}.\n\n## Fields\n* ui embed scope binding: embed\n* ui embed scope binding: key\n* ui embed scope binding: source\n* ui embed scope binding: alias\n", "__id": "ui embed scope binding|manual content block|content|# ui embed scope binding\nUi Embed Scope Binding is a {is a: system} and {is a: table}.\n\n## Fields\n* ui embed scope binding: embed\n* ui embed scope binding: key\n* ui embed scope binding: source\n* ui embed scope binding: alias\n" }, { "entity": "ui attribute|manual content block", "attribute": "is a", "value": "content block", "__id": "ui attribute|manual content block|is a|content block" }, { "entity": "ui attribute|manual content block", "attribute": "source", "value": "manual", "__id": "ui attribute|manual content block|source|manual" }, { "entity": "ui attribute|manual content block", "attribute": "associated entity", "value": "ui attribute", "__id": "ui attribute|manual content block|associated entity|ui attribute" }, { "entity": "ui attribute|manual content block", "attribute": "content", "value": "# ui attribute\nUi Attribute is a {is a: system} and {is a: table}.\n\n## Fields\n* ui attribute: template\n* ui attribute: property\n* ui attribute: value\n", "__id": "ui attribute|manual content block|content|# ui attribute\nUi Attribute is a {is a: system} and {is a: table}.\n\n## Fields\n* ui attribute: template\n* ui attribute: property\n* ui attribute: value\n" }, { "entity": "ui attribute binding|manual content block", "attribute": "is a", "value": "content block", "__id": "ui attribute binding|manual content block|is a|content block" }, { "entity": "ui attribute binding|manual content block", "attribute": "source", "value": "manual", "__id": "ui attribute binding|manual content block|source|manual" }, { "entity": "ui attribute binding|manual content block", "attribute": "associated entity", "value": "ui attribute binding", "__id": "ui attribute binding|manual content block|associated entity|ui attribute binding" }, { "entity": "ui attribute binding|manual content block", "attribute": "content", "value": "# ui attribute binding\nUi Attribute Binding is a {is a: system} and {is a: table}.\n\n## Fields\n* ui attribute binding: template\n* ui attribute binding: property\n* ui attribute binding: source\n* ui attribute binding: alias\n", "__id": "ui attribute binding|manual content block|content|# ui attribute binding\nUi Attribute Binding is a {is a: system} and {is a: table}.\n\n## Fields\n* ui attribute binding: template\n* ui attribute binding: property\n* ui attribute binding: source\n* ui attribute binding: alias\n" }, { "entity": "ui event|manual content block", "attribute": "is a", "value": "content block", "__id": "ui event|manual content block|is a|content block" }, { "entity": "ui event|manual content block", "attribute": "source", "value": "manual", "__id": "ui event|manual content block|source|manual" }, { "entity": "ui event|manual content block", "attribute": "associated entity", "value": "ui event", "__id": "ui event|manual content block|associated entity|ui event" }, { "entity": "ui event|manual content block", "attribute": "content", "value": "# ui event\nUi Event is a {is a: system} and {is a: table}.\n\n## Fields\n* ui event: template\n* ui event: event\n", "__id": "ui event|manual content block|content|# ui event\nUi Event is a {is a: system} and {is a: table}.\n\n## Fields\n* ui event: template\n* ui event: event\n" }, { "entity": "ui event state|manual content block", "attribute": "is a", "value": "content block", "__id": "ui event state|manual content block|is a|content block" }, { "entity": "ui event state|manual content block", "attribute": "source", "value": "manual", "__id": "ui event state|manual content block|source|manual" }, { "entity": "ui event state|manual content block", "attribute": "associated entity", "value": "ui event state", "__id": "ui event state|manual content block|associated entity|ui event state" }, { "entity": "ui event state|manual content block", "attribute": "content", "value": "# ui event state\nUi Event State is a {is a: system} and {is a: table}.\n\n## Fields\n* ui event state: template\n* ui event state: event\n* ui event state: key\n* ui event state: value\n", "__id": "ui event state|manual content block|content|# ui event state\nUi Event State is a {is a: system} and {is a: table}.\n\n## Fields\n* ui event state: template\n* ui event state: event\n* ui event state: key\n* ui event state: value\n" }, { "entity": "ui event state binding|manual content block", "attribute": "is a", "value": "content block", "__id": "ui event state binding|manual content block|is a|content block" }, { "entity": "ui event state binding|manual content block", "attribute": "source", "value": "manual", "__id": "ui event state binding|manual content block|source|manual" }, { "entity": "ui event state binding|manual content block", "attribute": "associated entity", "value": "ui event state binding", "__id": "ui event state binding|manual content block|associated entity|ui event state binding" }, { "entity": "ui event state binding|manual content block", "attribute": "content", "value": "# ui event state binding\nUi Event State Binding is a {is a: system} and {is a: table}.\n\n## Fields\n* ui event state binding: template\n* ui event state binding: event\n* ui event state binding: key\n* ui event state binding: source\n* ui event state binding: alias\n", "__id": "ui event state binding|manual content block|content|# ui event state binding\nUi Event State Binding is a {is a: system} and {is a: table}.\n\n## Fields\n* ui event state binding: template\n* ui event state binding: event\n* ui event state binding: key\n* ui event state binding: source\n* ui event state binding: alias\n" }, { "entity": "system ui|manual content block", "attribute": "is a", "value": "content block", "__id": "system ui|manual content block|is a|content block" }, { "entity": "system ui|manual content block", "attribute": "source", "value": "manual", "__id": "system ui|manual content block|source|manual" }, { "entity": "system ui|manual content block", "attribute": "associated entity", "value": "system ui", "__id": "system ui|manual content block|associated entity|system ui" }, { "entity": "system ui|manual content block", "attribute": "content", "value": "# system ui\nSystem Ui is a {is a: system} and {is a: table}.\n\n## Fields\n* template\n", "__id": "system ui|manual content block|content|# system ui\nSystem Ui is a {is a: system} and {is a: table}.\n\n## Fields\n* template\n" }], "field": [{ "view": "manual entity", "field": "entity", "__id": "manual entity|entity" }, { "view": "manual entity", "field": "content", "__id": "manual entity|content" }, { "view": "manual eav", "field": "entity", "__id": "manual eav|entity" }, { "view": "manual eav", "field": "attribute", "__id": "manual eav|attribute" }, { "view": "manual eav", "field": "value", "__id": "manual eav|value" }, { "view": "action entity", "field": "entity", "__id": "action entity|entity" }, { "view": "action entity", "field": "content", "__id": "action entity|content" }, { "view": "action entity", "field": "source", "__id": "action entity|source" }, { "view": "entity", "field": "entity", "__id": "entity|entity" }, { "view": "entity", "field": "content", "__id": "entity|content" }, { "view": "unmodified added bits", "field": "entity", "__id": "unmodified added bits|entity" }, { "view": "unmodified added bits", "field": "content", "__id": "unmodified added bits|content" }, { "view": "content blocks", "field": "block", "__id": "content blocks|block" }, { "view": "content blocks", "field": "entity", "__id": "content blocks|entity" }, { "view": "content blocks", "field": "content", "__id": "content blocks|content" }, { "view": "parsed content blocks", "field": "entity", "__id": "parsed content blocks|entity" }, { "view": "parsed content blocks", "field": "attribute", "__id": "parsed content blocks|attribute" }, { "view": "parsed content blocks", "field": "value", "__id": "parsed content blocks|value" }, { "view": "parsed eavs", "field": "entity", "__id": "parsed eavs|entity" }, { "view": "parsed eavs", "field": "attribute", "__id": "parsed eavs|attribute" }, { "view": "parsed eavs", "field": "value", "__id": "parsed eavs|value" }, { "view": "entity eavs", "field": "entity", "__id": "entity eavs|entity" }, { "view": "entity eavs", "field": "attribute", "__id": "entity eavs|attribute" }, { "view": "entity eavs", "field": "value", "__id": "entity eavs|value" }, { "view": "builtin entity eavs", "field": "entity", "__id": "builtin entity eavs|entity" }, { "view": "builtin entity eavs", "field": "attribute", "__id": "builtin entity eavs|attribute" }, { "view": "builtin entity eavs", "field": "value", "__id": "builtin entity eavs|value" }, { "view": "is a attributes", "field": "collection", "__id": "is a attributes|collection" }, { "view": "is a attributes", "field": "entity", "__id": "is a attributes|entity" }, { "view": "lowercase eavs", "field": "entity", "__id": "lowercase eavs|entity" }, { "view": "lowercase eavs", "field": "attribute", "__id": "lowercase eavs|attribute" }, { "view": "lowercase eavs", "field": "value", "__id": "lowercase eavs|value" }, { "view": "eav entity links", "field": "entity", "__id": "eav entity links|entity" }, { "view": "eav entity links", "field": "link", "__id": "eav entity links|link" }, { "view": "eav entity links", "field": "type", "__id": "eav entity links|type" }, { "view": "entity links", "field": "entity", "__id": "entity links|entity" }, { "view": "entity links", "field": "link", "__id": "entity links|link" }, { "view": "entity links", "field": "type", "__id": "entity links|type" }, { "view": "builtin entity links", "field": "entity", "__id": "builtin entity links|entity" }, { "view": "builtin entity links", "field": "link", "__id": "builtin entity links|link" }, { "view": "builtin entity links", "field": "type", "__id": "builtin entity links|type" }, { "view": "directionless links", "field": "entity", "__id": "directionless links|entity" }, { "view": "directionless links", "field": "link", "__id": "directionless links|link" }, { "view": "builtin directionless links", "field": "entity", "__id": "builtin directionless links|entity" }, { "view": "builtin directionless links", "field": "link", "__id": "builtin directionless links|link" }, { "view": "collection entities", "field": "entity", "__id": "collection entities|entity" }, { "view": "collection entities", "field": "collection", "__id": "collection entities|collection" }, { "view": "builtin collection entities", "field": "entity", "__id": "builtin collection entities|entity" }, { "view": "builtin collection entities", "field": "collection", "__id": "builtin collection entities|collection" }, { "view": "collection", "field": "collection", "__id": "collection|collection" }, { "view": "collection", "field": "count", "__id": "collection|count" }, { "view": "search", "field": "id", "__id": "search|id" }, { "view": "search", "field": "top", "__id": "search|top" }, { "view": "search", "field": "left", "__id": "search|left" }, { "view": "builtin search", "field": "id", "__id": "builtin search|id" }, { "view": "builtin search", "field": "top", "__id": "builtin search|top" }, { "view": "builtin search", "field": "left", "__id": "builtin search|left" }, { "view": "search query", "field": "id", "__id": "search query|id" }, { "view": "search query", "field": "search", "__id": "search query|search" }, { "view": "builtin search query", "field": "id", "__id": "builtin search query|id" }, { "view": "builtin search query", "field": "search", "__id": "builtin search query|search" }, { "view": "searches to entities shim", "field": "id", "__id": "searches to entities shim|id" }, { "view": "searches to entities shim", "field": "search", "__id": "searches to entities shim|search" }, { "view": "searches to entities shim", "field": "top", "__id": "searches to entities shim|top" }, { "view": "searches to entities shim", "field": "left", "__id": "searches to entities shim|left" }, { "view": "ui template", "field": "ui template: template", "__id": "ui template|ui template: template" }, { "view": "ui template", "field": "ui template: parent", "__id": "ui template|ui template: parent" }, { "view": "ui template", "field": "ui template: ix", "__id": "ui template|ui template: ix" }, { "view": "ui template binding", "field": "ui template binding: template", "__id": "ui template binding|ui template binding: template" }, { "view": "ui template binding", "field": "ui template binding: query", "__id": "ui template binding|ui template binding: query" }, { "view": "ui embed", "field": "ui embed: embed", "__id": "ui embed|ui embed: embed" }, { "view": "ui embed", "field": "ui embed: template", "__id": "ui embed|ui embed: template" }, { "view": "ui embed", "field": "ui embed: parent", "__id": "ui embed|ui embed: parent" }, { "view": "ui embed", "field": "ui embed: ix", "__id": "ui embed|ui embed: ix" }, { "view": "ui embed scope", "field": "ui embed scope: embed", "__id": "ui embed scope|ui embed scope: embed" }, { "view": "ui embed scope", "field": "ui embed scope: key", "__id": "ui embed scope|ui embed scope: key" }, { "view": "ui embed scope", "field": "ui embed scope: value", "__id": "ui embed scope|ui embed scope: value" }, { "view": "ui embed scope binding", "field": "ui embed scope binding: embed", "__id": "ui embed scope binding|ui embed scope binding: embed" }, { "view": "ui embed scope binding", "field": "ui embed scope binding: key", "__id": "ui embed scope binding|ui embed scope binding: key" }, { "view": "ui embed scope binding", "field": "ui embed scope binding: source", "__id": "ui embed scope binding|ui embed scope binding: source" }, { "view": "ui embed scope binding", "field": "ui embed scope binding: alias", "__id": "ui embed scope binding|ui embed scope binding: alias" }, { "view": "ui attribute", "field": "ui attribute: template", "__id": "ui attribute|ui attribute: template" }, { "view": "ui attribute", "field": "ui attribute: property", "__id": "ui attribute|ui attribute: property" }, { "view": "ui attribute", "field": "ui attribute: value", "__id": "ui attribute|ui attribute: value" }, { "view": "ui attribute binding", "field": "ui attribute binding: template", "__id": "ui attribute binding|ui attribute binding: template" }, { "view": "ui attribute binding", "field": "ui attribute binding: property", "__id": "ui attribute binding|ui attribute binding: property" }, { "view": "ui attribute binding", "field": "ui attribute binding: source", "__id": "ui attribute binding|ui attribute binding: source" }, { "view": "ui attribute binding", "field": "ui attribute binding: alias", "__id": "ui attribute binding|ui attribute binding: alias" }, { "view": "ui event", "field": "ui event: template", "__id": "ui event|ui event: template" }, { "view": "ui event", "field": "ui event: event", "__id": "ui event|ui event: event" }, { "view": "ui event state", "field": "ui event state: template", "__id": "ui event state|ui event state: template" }, { "view": "ui event state", "field": "ui event state: event", "__id": "ui event state|ui event state: event" }, { "view": "ui event state", "field": "ui event state: key", "__id": "ui event state|ui event state: key" }, { "view": "ui event state", "field": "ui event state: value", "__id": "ui event state|ui event state: value" }, { "view": "ui event state binding", "field": "ui event state binding: template", "__id": "ui event state binding|ui event state binding: template" }, { "view": "ui event state binding", "field": "ui event state binding: event", "__id": "ui event state binding|ui event state binding: event" }, { "view": "ui event state binding", "field": "ui event state binding: key", "__id": "ui event state binding|ui event state binding: key" }, { "view": "ui event state binding", "field": "ui event state binding: source", "__id": "ui event state binding|ui event state binding: source" }, { "view": "ui event state binding", "field": "ui event state binding: alias", "__id": "ui event state binding|ui event state binding: alias" }, { "view": "system ui", "field": "template", "__id": "system ui|template" }], "builtin entity": [{ "entity": "wiki root", "content": "# Wiki Root ({is a: system}, {is a: ui})\n", "__id": "wiki root|# Wiki Root ({is a: system}, {is a: ui})\n" }, { "entity": "perf stats", "content": "# Perf Stats ({is a: system}, {is a: ui})\n", "__id": "perf stats|# Perf Stats ({is a: system}, {is a: ui})\n" }, { "entity": "searches to entities shim", "content": "# Searches To Entities Shim ({is a: system}, {is a: query})\n\n## Fields\n* id\n* search\n* top\n* left\n", "__id": "searches to entities shim|# Searches To Entities Shim ({is a: system}, {is a: query})\n\n## Fields\n* id\n* search\n* top\n* left\n" }, { "entity": "render performance statistics", "content": "\n    # Render performance statistics ({is a: system})\n    root: {root: 1.71}\n    ui compile: {ui compile: 0.04}\n    render: {render: 0.35}\n    update: {update: 0.28}\n    Horrible hack, disregard this: {perf stats: render performance statistics}\n    ", "__id": "render performance statistics|\n    # Render performance statistics ({is a: system})\n    root: {root: 1.71}\n    ui compile: {ui compile: 0.04}\n    render: {render: 0.35}\n    update: {update: 0.28}\n    Horrible hack, disregard this: {perf stats: render performance statistics}\n    " }], "builtin search": [{ "id": "a92fad47-ccad-485e-80ab-09ba901975b4", "top": 114, "left": 94, "__id": "a92fad47-ccad-485e-80ab-09ba901975b4|114|94" }, { "id": "76eb6ec8-ca8b-4fd1-958f-b744a84c877d", "top": 55, "left": 721, "__id": "76eb6ec8-ca8b-4fd1-958f-b744a84c877d|55|721" }], "builtin search query": [{ "id": "a92fad47-ccad-485e-80ab-09ba901975b4", "search": "sum of salaries per department", "__id": "a92fad47-ccad-485e-80ab-09ba901975b4|sum of salaries per department" }, { "id": "76eb6ec8-ca8b-4fd1-958f-b744a84c877d", "search": "edward norton", "__id": "76eb6ec8-ca8b-4fd1-958f-b744a84c877d|edward norton" }], "ui template": [{ "ui template: template": "wiki root", "ui template: parent": "", "ui template: ix": "", "__id": "wiki root||" }, { "ui template: template": "5800184d-9953-4d71-b3f0-439c49e54c11", "ui template: parent": "3f232603-3f00-4526-abc7-c4b7d298d5c2", "ui template: ix": 2, "__id": "5800184d-9953-4d71-b3f0-439c49e54c11|3f232603-3f00-4526-abc7-c4b7d298d5c2|2" }, { "ui template: template": "0dccfaee-91a5-4a01-8cde-0fb050cf806b", "ui template: parent": "3e83d7e6-f132-4b01-ad7a-79949b82687a", "ui template: ix": 0, "__id": "0dccfaee-91a5-4a01-8cde-0fb050cf806b|3e83d7e6-f132-4b01-ad7a-79949b82687a|0" }, { "ui template: template": "perf stats", "ui template: parent": "", "ui template: ix": 0, "__id": "perf stats||0" }, { "ui template: template": "a9972427-a5d2-4656-af4a-5c06d5c1f597", "ui template: parent": "3e83d7e6-f132-4b01-ad7a-79949b82687a", "ui template: ix": 1, "__id": "a9972427-a5d2-4656-af4a-5c06d5c1f597|3e83d7e6-f132-4b01-ad7a-79949b82687a|1" }, { "ui template: template": "8b74983c-2a52-4c56-9114-c549fe6b1ce2", "ui template: parent": "3e83d7e6-f132-4b01-ad7a-79949b82687a", "ui template: ix": 2, "__id": "8b74983c-2a52-4c56-9114-c549fe6b1ce2|3e83d7e6-f132-4b01-ad7a-79949b82687a|2" }, { "ui template: template": "3f4c7467-f3cc-412e-b1da-054c44da648c", "ui template: parent": "103b3f2c-02d9-4912-93b5-d80004e6fe9e", "ui template: ix": 0, "__id": "3f4c7467-f3cc-412e-b1da-054c44da648c|103b3f2c-02d9-4912-93b5-d80004e6fe9e|0" }, { "ui template: template": "e67dbd78-77b1-415f-9292-b492228f7513", "ui template: parent": "8f7df862-986c-475a-9624-d8ace89e3c07", "ui template: ix": 0, "__id": "e67dbd78-77b1-415f-9292-b492228f7513|8f7df862-986c-475a-9624-d8ace89e3c07|0" }, { "ui template: template": "8456491f-af91-4eef-9317-73a8d38a8769", "ui template: parent": "wiki root", "ui template: ix": 0, "__id": "8456491f-af91-4eef-9317-73a8d38a8769|wiki root|0" }, { "ui template: template": "bfda829a-de8e-460b-8694-987ed975c234", "ui template: parent": "3f232603-3f00-4526-abc7-c4b7d298d5c2", "ui template: ix": 3, "__id": "bfda829a-de8e-460b-8694-987ed975c234|3f232603-3f00-4526-abc7-c4b7d298d5c2|3" }, { "ui template: template": "2db6509c-dd44-40f4-9c83-a122352f36cc", "ui template: parent": "0dccfaee-91a5-4a01-8cde-0fb050cf806b", "ui template: ix": 0, "__id": "2db6509c-dd44-40f4-9c83-a122352f36cc|0dccfaee-91a5-4a01-8cde-0fb050cf806b|0" }, { "ui template: template": "103b3f2c-02d9-4912-93b5-d80004e6fe9e", "ui template: parent": "3f232603-3f00-4526-abc7-c4b7d298d5c2", "ui template: ix": 0, "__id": "103b3f2c-02d9-4912-93b5-d80004e6fe9e|3f232603-3f00-4526-abc7-c4b7d298d5c2|0" }, { "ui template: template": "3f232603-3f00-4526-abc7-c4b7d298d5c2", "ui template: parent": "perf stats", "ui template: ix": 0, "__id": "3f232603-3f00-4526-abc7-c4b7d298d5c2|perf stats|0" }, { "ui template: template": "18531d14-6f9d-460a-b616-24539d28c180", "ui template: parent": "bacc3e2c-031b-4d9c-9cda-774bd7befe30", "ui template: ix": 1, "__id": "18531d14-6f9d-460a-b616-24539d28c180|bacc3e2c-031b-4d9c-9cda-774bd7befe30|1" }, { "ui template: template": "perf stats", "ui template: parent": "", "ui template: ix": "", "__id": "perf stats||" }, { "ui template: template": "db9e9258-1ab7-4fd6-9d6c-8e869e04c94b", "ui template: parent": "bfda829a-de8e-460b-8694-987ed975c234", "ui template: ix": 0, "__id": "db9e9258-1ab7-4fd6-9d6c-8e869e04c94b|bfda829a-de8e-460b-8694-987ed975c234|0" }, { "ui template: template": "3e83d7e6-f132-4b01-ad7a-79949b82687a", "ui template: parent": "9f0e2b91-513c-4d5b-8558-6383386ee844", "ui template: ix": 0, "__id": "3e83d7e6-f132-4b01-ad7a-79949b82687a|9f0e2b91-513c-4d5b-8558-6383386ee844|0" }, { "ui template: template": "d8d05641-f867-457c-adc3-ba8c64efd07f", "ui template: parent": "5800184d-9953-4d71-b3f0-439c49e54c11", "ui template: ix": 0, "__id": "d8d05641-f867-457c-adc3-ba8c64efd07f|5800184d-9953-4d71-b3f0-439c49e54c11|0" }, { "ui template: template": "bacc3e2c-031b-4d9c-9cda-774bd7befe30", "ui template: parent": "8b74983c-2a52-4c56-9114-c549fe6b1ce2", "ui template: ix": 0, "__id": "bacc3e2c-031b-4d9c-9cda-774bd7befe30|8b74983c-2a52-4c56-9114-c549fe6b1ce2|0" }, { "ui template: template": "f51f9bf1-230d-4a8b-8671-a1d7c35bb2cc", "ui template: parent": "8456491f-af91-4eef-9317-73a8d38a8769", "ui template: ix": 0, "__id": "f51f9bf1-230d-4a8b-8671-a1d7c35bb2cc|8456491f-af91-4eef-9317-73a8d38a8769|0" }, { "ui template: template": "8f7df862-986c-475a-9624-d8ace89e3c07", "ui template: parent": "3f232603-3f00-4526-abc7-c4b7d298d5c2", "ui template: ix": 1, "__id": "8f7df862-986c-475a-9624-d8ace89e3c07|3f232603-3f00-4526-abc7-c4b7d298d5c2|1" }, { "ui template: template": "674867da-6ea2-4490-a571-a7712cb9fb20", "ui template: parent": "bacc3e2c-031b-4d9c-9cda-774bd7befe30", "ui template: ix": 0, "__id": "674867da-6ea2-4490-a571-a7712cb9fb20|bacc3e2c-031b-4d9c-9cda-774bd7befe30|0" }, { "ui template: template": "47324bdd-3312-47d9-831c-78fba05a7342", "ui template: parent": "bacc3e2c-031b-4d9c-9cda-774bd7befe30", "ui template: ix": 2, "__id": "47324bdd-3312-47d9-831c-78fba05a7342|bacc3e2c-031b-4d9c-9cda-774bd7befe30|2" }, { "ui template: template": "9f0e2b91-513c-4d5b-8558-6383386ee844", "ui template: parent": "8456491f-af91-4eef-9317-73a8d38a8769", "ui template: ix": 1, "__id": "9f0e2b91-513c-4d5b-8558-6383386ee844|8456491f-af91-4eef-9317-73a8d38a8769|1" }], "ui template binding": [{ "ui template binding: template": "3f232603-3f00-4526-abc7-c4b7d298d5c2", "ui template binding: binding": "bound view 3f232603-3f00-4526-abc7-c4b7d298d5c2", "__id": "3f232603-3f00-4526-abc7-c4b7d298d5c2|undefined" }, { "ui template binding: template": "3e83d7e6-f132-4b01-ad7a-79949b82687a", "ui template binding: binding": "bound view 3e83d7e6-f132-4b01-ad7a-79949b82687a", "__id": "3e83d7e6-f132-4b01-ad7a-79949b82687a|undefined" }], "ui embed": [{ "ui embed: embed": "2908d4ad-d158-44e6-912d-52eb141bbe32", "ui embed: template": "perf stats", "ui embed: parent": "f51f9bf1-230d-4a8b-8671-a1d7c35bb2cc", "ui embed: ix": 0, "__id": "2908d4ad-d158-44e6-912d-52eb141bbe32|perf stats|f51f9bf1-230d-4a8b-8671-a1d7c35bb2cc|0" }], "ui attribute": [{ "ui attribute: template": "3e83d7e6-f132-4b01-ad7a-79949b82687a", "ui attribute: property": "t", "ui attribute: value": "search", "__id": "3e83d7e6-f132-4b01-ad7a-79949b82687a|t|search" }, { "ui attribute: template": "47324bdd-3312-47d9-831c-78fba05a7342", "ui attribute: property": "t", "ui attribute: value": "button", "__id": "47324bdd-3312-47d9-831c-78fba05a7342|t|button" }, { "ui attribute: template": "db9e9258-1ab7-4fd6-9d6c-8e869e04c94b", "ui attribute: property": "t", "ui attribute: value": "span", "__id": "db9e9258-1ab7-4fd6-9d6c-8e869e04c94b|t|span" }, { "ui attribute: template": "8456491f-af91-4eef-9317-73a8d38a8769", "ui attribute: property": "color", "ui attribute: value": "red", "__id": "8456491f-af91-4eef-9317-73a8d38a8769|color|red" }, { "ui attribute: template": "5800184d-9953-4d71-b3f0-439c49e54c11", "ui attribute: property": "t", "ui attribute: value": "label", "__id": "5800184d-9953-4d71-b3f0-439c49e54c11|t|label" }, { "ui attribute: template": "103b3f2c-02d9-4912-93b5-d80004e6fe9e", "ui attribute: property": "t", "ui attribute: value": "label", "__id": "103b3f2c-02d9-4912-93b5-d80004e6fe9e|t|label" }, { "ui attribute: template": "8b74983c-2a52-4c56-9114-c549fe6b1ce2", "ui attribute: property": "c", "ui attribute: value": "search-actions", "__id": "8b74983c-2a52-4c56-9114-c549fe6b1ce2|c|search-actions" }, { "ui attribute: template": "a9972427-a5d2-4656-af4a-5c06d5c1f597", "ui attribute: property": "t", "ui attribute: value": "content", "__id": "a9972427-a5d2-4656-af4a-5c06d5c1f597|t|content" }, { "ui attribute: template": "d8d05641-f867-457c-adc3-ba8c64efd07f", "ui attribute: property": "t", "ui attribute: value": "span", "__id": "d8d05641-f867-457c-adc3-ba8c64efd07f|t|span" }, { "ui attribute: template": "3f232603-3f00-4526-abc7-c4b7d298d5c2", "ui attribute: property": "c", "ui attribute: value": "perf-stats", "__id": "3f232603-3f00-4526-abc7-c4b7d298d5c2|c|perf-stats" }, { "ui attribute: template": "8456491f-af91-4eef-9317-73a8d38a8769", "ui attribute: property": "c", "ui attribute: value": "wiki-root", "__id": "8456491f-af91-4eef-9317-73a8d38a8769|c|wiki-root" }, { "ui attribute: template": "8456491f-af91-4eef-9317-73a8d38a8769", "ui attribute: property": "t", "ui attribute: value": "div", "__id": "8456491f-af91-4eef-9317-73a8d38a8769|t|div" }, { "ui attribute: template": "0dccfaee-91a5-4a01-8cde-0fb050cf806b", "ui attribute: property": "c", "ui attribute: value": "search-header", "__id": "0dccfaee-91a5-4a01-8cde-0fb050cf806b|c|search-header" }, { "ui attribute: template": "3e83d7e6-f132-4b01-ad7a-79949b82687a", "ui attribute: property": "c", "ui attribute: value": "container search-container", "__id": "3e83d7e6-f132-4b01-ad7a-79949b82687a|c|container search-container" }, { "ui attribute: template": "47324bdd-3312-47d9-831c-78fba05a7342", "ui attribute: property": "text", "ui attribute: value": "+ collection", "__id": "47324bdd-3312-47d9-831c-78fba05a7342|text|+ collection" }, { "ui attribute: template": "bfda829a-de8e-460b-8694-987ed975c234", "ui attribute: property": "t", "ui attribute: value": "label", "__id": "bfda829a-de8e-460b-8694-987ed975c234|t|label" }, { "ui attribute: template": "bfda829a-de8e-460b-8694-987ed975c234", "ui attribute: property": "text", "ui attribute: value": "update", "__id": "bfda829a-de8e-460b-8694-987ed975c234|text|update" }, { "ui attribute: template": "8f7df862-986c-475a-9624-d8ace89e3c07", "ui attribute: property": "t", "ui attribute: value": "label", "__id": "8f7df862-986c-475a-9624-d8ace89e3c07|t|label" }, { "ui attribute: template": "8b74983c-2a52-4c56-9114-c549fe6b1ce2", "ui attribute: property": "t", "ui attribute: value": "footer", "__id": "8b74983c-2a52-4c56-9114-c549fe6b1ce2|t|footer" }, { "ui attribute: template": "5800184d-9953-4d71-b3f0-439c49e54c11", "ui attribute: property": "text", "ui attribute: value": "render", "__id": "5800184d-9953-4d71-b3f0-439c49e54c11|text|render" }, { "ui attribute: template": "e67dbd78-77b1-415f-9292-b492228f7513", "ui attribute: property": "t", "ui attribute: value": "span", "__id": "e67dbd78-77b1-415f-9292-b492228f7513|t|span" }, { "ui attribute: template": "674867da-6ea2-4490-a571-a7712cb9fb20", "ui attribute: property": "t", "ui attribute: value": "button", "__id": "674867da-6ea2-4490-a571-a7712cb9fb20|t|button" }, { "ui attribute: template": "2db6509c-dd44-40f4-9c83-a122352f36cc", "ui attribute: property": "c", "ui attribute: value": "search-input", "__id": "2db6509c-dd44-40f4-9c83-a122352f36cc|c|search-input" }, { "ui attribute: template": "18531d14-6f9d-460a-b616-24539d28c180", "ui attribute: property": "t", "ui attribute: value": "button", "__id": "18531d14-6f9d-460a-b616-24539d28c180|t|button" }, { "ui attribute: template": "103b3f2c-02d9-4912-93b5-d80004e6fe9e", "ui attribute: property": "text", "ui attribute: value": "root", "__id": "103b3f2c-02d9-4912-93b5-d80004e6fe9e|text|root" }, { "ui attribute: template": "8f7df862-986c-475a-9624-d8ace89e3c07", "ui attribute: property": "text", "ui attribute: value": "ui compile", "__id": "8f7df862-986c-475a-9624-d8ace89e3c07|text|ui compile" }, { "ui attribute: template": "674867da-6ea2-4490-a571-a7712cb9fb20", "ui attribute: property": "text", "ui attribute: value": "+ entity", "__id": "674867da-6ea2-4490-a571-a7712cb9fb20|text|+ entity" }, { "ui attribute: template": "3f232603-3f00-4526-abc7-c4b7d298d5c2", "ui attribute: property": "t", "ui attribute: value": "row", "__id": "3f232603-3f00-4526-abc7-c4b7d298d5c2|t|row" }, { "ui attribute: template": "3f4c7467-f3cc-412e-b1da-054c44da648c", "ui attribute: property": "t", "ui attribute: value": "span", "__id": "3f4c7467-f3cc-412e-b1da-054c44da648c|t|span" }, { "ui attribute: template": "bacc3e2c-031b-4d9c-9cda-774bd7befe30", "ui attribute: property": "t", "ui attribute: value": "row", "__id": "bacc3e2c-031b-4d9c-9cda-774bd7befe30|t|row" }, { "ui attribute: template": "18531d14-6f9d-460a-b616-24539d28c180", "ui attribute: property": "text", "ui attribute: value": "+ attribute", "__id": "18531d14-6f9d-460a-b616-24539d28c180|text|+ attribute" }, { "ui attribute: template": "0dccfaee-91a5-4a01-8cde-0fb050cf806b", "ui attribute: property": "t", "ui attribute: value": "header", "__id": "0dccfaee-91a5-4a01-8cde-0fb050cf806b|t|header" }, { "ui attribute: template": "f51f9bf1-230d-4a8b-8671-a1d7c35bb2cc", "ui attribute: property": "t", "ui attribute: value": "header", "__id": "f51f9bf1-230d-4a8b-8671-a1d7c35bb2cc|t|header" }, { "ui attribute: template": "2db6509c-dd44-40f4-9c83-a122352f36cc", "ui attribute: property": "t", "ui attribute: value": "div", "__id": "2db6509c-dd44-40f4-9c83-a122352f36cc|t|div" }, { "ui attribute: template": "9f0e2b91-513c-4d5b-8558-6383386ee844", "ui attribute: property": "t", "ui attribute: value": "content", "__id": "9f0e2b91-513c-4d5b-8558-6383386ee844|t|content" }], "ui attribute binding": [{ "ui attribute binding: template": "db9e9258-1ab7-4fd6-9d6c-8e869e04c94b", "ui attribute binding: property": "text", "ui attribute binding: source": "perf stats", "ui attribute binding: alias": "update", "__id": "db9e9258-1ab7-4fd6-9d6c-8e869e04c94b|text|perf stats|update" }, { "ui attribute binding: template": "2db6509c-dd44-40f4-9c83-a122352f36cc", "ui attribute binding: property": "text", "ui attribute binding: source": "search", "ui attribute binding: alias": "search 2", "__id": "2db6509c-dd44-40f4-9c83-a122352f36cc|text|search|search 2" }, { "ui attribute binding: template": "e67dbd78-77b1-415f-9292-b492228f7513", "ui attribute binding: property": "text", "ui attribute binding: source": "perf stats", "ui attribute binding: alias": "ui compile", "__id": "e67dbd78-77b1-415f-9292-b492228f7513|text|perf stats|ui compile" }, { "ui attribute binding: template": "3f4c7467-f3cc-412e-b1da-054c44da648c", "ui attribute binding: property": "text", "ui attribute binding: source": "perf stats", "ui attribute binding: alias": "root", "__id": "3f4c7467-f3cc-412e-b1da-054c44da648c|text|perf stats|root" }, { "ui attribute binding: template": "3e83d7e6-f132-4b01-ad7a-79949b82687a", "ui attribute binding: property": "top", "ui attribute binding: source": "search", "ui attribute binding: alias": "top", "__id": "3e83d7e6-f132-4b01-ad7a-79949b82687a|top|search|top" }, { "ui attribute binding: template": "3e83d7e6-f132-4b01-ad7a-79949b82687a", "ui attribute binding: property": "left", "ui attribute binding: source": "search", "ui attribute binding: alias": "left", "__id": "3e83d7e6-f132-4b01-ad7a-79949b82687a|left|search|left" }, { "ui attribute binding: template": "d8d05641-f867-457c-adc3-ba8c64efd07f", "ui attribute binding: property": "text", "ui attribute binding: source": "perf stats", "ui attribute binding: alias": "render", "__id": "d8d05641-f867-457c-adc3-ba8c64efd07f|text|perf stats|render" }], "ui event": [{ "ui event: template": "674867da-6ea2-4490-a571-a7712cb9fb20", "ui event: event": "click", "__id": "674867da-6ea2-4490-a571-a7712cb9fb20|click" }, { "ui event: template": "47324bdd-3312-47d9-831c-78fba05a7342", "ui event: event": "click", "__id": "47324bdd-3312-47d9-831c-78fba05a7342|click" }, { "ui event: template": "18531d14-6f9d-460a-b616-24539d28c180", "ui event: event": "click", "__id": "18531d14-6f9d-460a-b616-24539d28c180|click" }], "ui event state": [{ "ui event state: template": "674867da-6ea2-4490-a571-a7712cb9fb20", "ui event state: event": "click", "ui event state: key": "kind", "ui event state: value": "add entity action", "__id": "674867da-6ea2-4490-a571-a7712cb9fb20|click|kind|add entity action" }, { "ui event state: template": "47324bdd-3312-47d9-831c-78fba05a7342", "ui event state: event": "click", "ui event state: key": "kind", "ui event state: value": "add collection action", "__id": "47324bdd-3312-47d9-831c-78fba05a7342|click|kind|add collection action" }, { "ui event state: template": "18531d14-6f9d-460a-b616-24539d28c180", "ui event state: event": "click", "ui event state: key": "kind", "ui event state: value": "add attribute action", "__id": "18531d14-6f9d-460a-b616-24539d28c180|click|kind|add attribute action" }], "ui event state binding": [{ "ui event state binding: template": "674867da-6ea2-4490-a571-a7712cb9fb20", "ui event state binding: event": "click", "ui event state binding: key": "id", "ui event state binding: source": "search", "ui event state binding: alias": "id", "__id": "674867da-6ea2-4490-a571-a7712cb9fb20|click|id|search|id" }, { "ui event state binding: template": "47324bdd-3312-47d9-831c-78fba05a7342", "ui event state binding: event": "click", "ui event state binding: key": "id", "ui event state binding: source": "search", "ui event state binding: alias": "id", "__id": "47324bdd-3312-47d9-831c-78fba05a7342|click|id|search|id" }, { "ui event state binding: template": "18531d14-6f9d-460a-b616-24539d28c180", "ui event state binding: event": "click", "ui event state binding: key": "id", "ui event state binding: source": "search", "ui event state binding: alias": "id", "__id": "18531d14-6f9d-460a-b616-24539d28c180|click|id|search|id" }], "system ui": [{ "template": "wiki root", "__id": "wiki root" }], "history stack": [{ "entity": "foo", "pos": 0, "__id": "foo|0" }, { "entity": "engineering", "pos": 1, "__id": "engineering|1" }, { "entity": "chris granger", "pos": 2, "__id": "chris granger|2" }, { "entity": "josh cole", "pos": 3, "__id": "josh cole|3" }, { "entity": "jamie brandon", "pos": 4, "__id": "jamie brandon|4" }, { "entity": "corey montella", "pos": 5, "__id": "corey montella|5" }, { "entity": "eric hoffman", "pos": 6, "__id": "eric hoffman|6" }, { "entity": "sum people's ages", "pos": 7, "__id": "sum people's ages|7" }, { "entity": "operations", "pos": 8, "__id": "operations|8" }, { "entity": "sum of salaries per department", "pos": 9, "__id": "sum of salaries per department|9" }, { "entity": "robert attorri", "pos": 10, "__id": "robert attorri|10" }, { "entity": "people ages", "pos": 11, "__id": "people ages|11" }, { "entity": "people ages and heights", "pos": 12, "__id": "people ages and heights|12" }, { "entity": "people's ages and heights", "pos": 13, "__id": "people's ages and heights|13" }, { "entity": "zomg", "pos": 14, "__id": "zomg|14" }, { "entity": "department", "pos": 15, "__id": "department|15" }, { "entity": "sum of the salaries per department", "pos": 16, "__id": "sum of the salaries per department|16" }, { "entity": "sum of the top 2 salaries per department", "pos": 17, "__id": "sum of the top 2 salaries per department|17" }, { "entity": "people's ages", "pos": 18, "__id": "people's ages|18" }, { "entity": "employee", "pos": 19, "__id": "employee|19" }, { "entity": "employees", "pos": 20, "__id": "employees|20" }, { "entity": "people", "pos": 21, "__id": "people|21" }, { "entity": "modern family", "pos": 22, "__id": "modern family|22" }, { "entity": "pilot", "pos": 23, "__id": "pilot|23" }, { "entity": "great expectations", "pos": 24, "__id": "great expectations|24" }, { "entity": "the bicycle thief", "pos": 25, "__id": "the bicycle thief|25" }, { "entity": "come fly with me", "pos": 26, "__id": "come fly with me|26" }, { "entity": "the incident", "pos": 27, "__id": "the incident|27" }, { "entity": "coal digger", "pos": 28, "__id": "coal digger|28" }, { "entity": "run for your wife", "pos": 29, "__id": "run for your wife|29" }, { "entity": "en garde", "pos": 30, "__id": "en garde|30" }, { "entity": "episodes of modern family", "pos": 31, "__id": "episodes of modern family|31" }, { "entity": "episodes of modern family without edward norton", "pos": 32, "__id": "episodes of modern family without edward norton|32" }, { "entity": "edward norton", "pos": 33, "__id": "edward norton|33" }, { "entity": "vin diesel", "pos": 34, "__id": "vin diesel|34" }, { "entity": "american", "pos": 35, "__id": "american|35" }, { "entity": "americans", "pos": 36, "__id": "americans|36" }, { "entity": "vin actors", "pos": 37, "__id": "vin actors|37" }, { "entity": "actor", "pos": 38, "__id": "actor|38" }, { "entity": "actors who are american", "pos": 39, "__id": "actors who are american|39" }, { "entity": "count the episodes of modern family without edward norton", "pos": 40, "__id": "count the episodes of modern family without edward norton|40" }, { "entity": "episodes of modern family with edward norton", "pos": 41, "__id": "episodes of modern family with edward norton|41" }, { "entity": "actors related to modern family", "pos": 42, "__id": "actors related to modern family|42" }, { "entity": "count episodes of modern family without edward norton", "pos": 43, "__id": "count episodes of modern family without edward norton|43" }, { "entity": "count of modern family episodes without edward norton", "pos": 44, "__id": "count of modern family episodes without edward norton|44" }, { "entity": "oyako don", "pos": 45, "__id": "oyako don|45" }, { "entity": "chicken", "pos": 46, "__id": "chicken|46" }, { "entity": "egg", "pos": 47, "__id": "egg|47" }, { "entity": "dishes", "pos": 48, "__id": "dishes|48" }, { "entity": "dishes that are sweet", "pos": 49, "__id": "dishes that are sweet|49" }, { "entity": "rice", "pos": 50, "__id": "rice|50" }, { "entity": "scallion", "pos": 51, "__id": "scallion|51" }, { "entity": "dishes with chicken", "pos": 52, "__id": "dishes with chicken|52" }, { "entity": "dishes with chicken and eggs", "pos": 53, "__id": "dishes with chicken and eggs|53" }, { "entity": "dishes with chicken and eggs and rice", "pos": 54, "__id": "dishes with chicken and eggs and rice|54" }, { "entity": "dishes with chicken and", "pos": 55, "__id": "dishes with chicken and|55" }, { "entity": "dishes with chicken and rice", "pos": 56, "__id": "dishes with chicken and rice|56" }, { "entity": "savory", "pos": 57, "__id": "savory|57" }, { "entity": "Apple Pie", "pos": 58, "__id": "Apple Pie|58" }, { "entity": "apple pie", "pos": 59, "__id": "apple pie|59" }, { "entity": "apple", "pos": 60, "__id": "apple|60" }, { "entity": "sweet", "pos": 61, "__id": "sweet|61" }, { "entity": "sweets", "pos": 62, "__id": "sweets|62" }, { "entity": "dishes with apple", "pos": 63, "__id": "dishes with apple|63" }, { "entity": "dishes that are sweet with rice", "pos": 64, "__id": "dishes that are sweet with rice|64" }, { "entity": "dishes that are sweet with apples", "pos": 65, "__id": "dishes that are sweet with apples|65" }, { "entity": "dishes that are sweet without apples", "pos": 66, "__id": "dishes that are sweet without apples|66" }, { "entity": "rice pudding", "pos": 67, "__id": "rice pudding|67" }, { "entity": "\"rice pudding\"", "pos": 68, "__id": "\"rice pudding\"|68" }, { "entity": "grains", "pos": 69, "__id": "grains|69" }, { "entity": "dishes that use a grain", "pos": 70, "__id": "dishes that use a grain|70" }, { "entity": "dishes that use a grain without chicken", "pos": 71, "__id": "dishes that use a grain without chicken|71" }, { "entity": "dishes that use a grain and don't have chicken", "pos": 72, "__id": "dishes that use a grain and don't have chicken|72" }, { "entity": "dishes that use a grain and don't have apples", "pos": 73, "__id": "dishes that use a grain and don't have apples|73" }, { "entity": "dishes that contain a grain and don't have apples", "pos": 74, "__id": "dishes that contain a grain and don't have apples|74" }, { "entity": "dishes that contain a grain and don't have scallions", "pos": 75, "__id": "dishes that contain a grain and don't have scallions|75" }, { "entity": "count ingredients per dish", "pos": 76, "__id": "count ingredients per dish|76" }, { "entity": "per dish count the ingredients", "pos": 77, "__id": "per dish count the ingredients|77" }, { "entity": "count of the ingredients per dish", "pos": 78, "__id": "count of the ingredients per dish|78" }, { "entity": "count ingredients per dish in my collection", "pos": 79, "__id": "count ingredients per dish in my collection|79" }, { "entity": "dishes in my collection", "pos": 80, "__id": "dishes in my collection|80" }, { "entity": "dishes in my collection ingredients", "pos": 81, "__id": "dishes in my collection ingredients|81" }, { "entity": "dishes in my collection per ingredients", "pos": 82, "__id": "dishes in my collection per ingredients|82" }, { "entity": "per dishes in my collection ingredients", "pos": 83, "__id": "per dishes in my collection ingredients|83" }, { "entity": "per dishes in my collection count ingredients", "pos": 84, "__id": "per dishes in my collection count ingredients|84" }, { "entity": "count ingredients my collection", "pos": 85, "__id": "count ingredients my collection|85" }, { "entity": "count ingredients in my collection", "pos": 86, "__id": "count ingredients in my collection|86" }, { "entity": "count ingredients in my collection per dish", "pos": 87, "__id": "count ingredients in my collection per dish|87" }, { "entity": "count dishes in my collection", "pos": 88, "__id": "count dishes in my collection|88" }, { "entity": "my collection", "pos": 89, "__id": "my collection|89" }, { "entity": "dishes without eggs", "pos": 90, "__id": "dishes without eggs|90" }, { "entity": "dishes without chicken and eggs", "pos": 91, "__id": "dishes without chicken and eggs|91" }, { "entity": "dishes without chicken and without eggs", "pos": 92, "__id": "dishes without chicken and without eggs|92" }, { "entity": "dishes that are chicken", "pos": 93, "__id": "dishes that are chicken|93" }, { "entity": "chicken quesadilla", "pos": 94, "__id": "chicken quesadilla|94" }, { "entity": "Terriyaki", "pos": 95, "__id": "Terriyaki|95" }, { "entity": "", "pos": 96, "__id": "|96" }, { "entity": "count per ingredient in my collection", "pos": 97, "__id": "count per ingredient in my collection|97" }, { "entity": "salaries per department", "pos": 98, "__id": "salaries per department|98" }, { "entity": "sum of the salaries per episode", "pos": 99, "__id": "sum of the salaries per episode|99" }, { "entity": "sum of the salaries per episode of modern family", "pos": 100, "__id": "sum of the salaries per episode of modern family|100" }, { "entity": "departments", "pos": 101, "__id": "departments|101" }, { "entity": "kodowa", "pos": 102, "__id": "kodowa|102" }, { "entity": "dishes without chicken", "pos": 103, "__id": "dishes without chicken|103" }], "added bits": [], "manual entity": [], "builtin entity eavs": [], "added eavs": [], "builtin entity links": [], "builtin directionless links": [], "builtin collection entities": [], "action entity": [], "ui embed scope": [], "ui embed scope binding": [], "adding action": [], "add bit action": [{ "view": "sum of salaries per department", "action": "sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}", "template": "# {department}\n{department} has a total cost of {total cost: {sum}}", "__id": "sum of salaries per department|sum of salaries per department|# {department}\n{department} has a total cost of {total cost: {sum}}|# {department}\n{department} has a total cost of {total cost: {sum}}" }] });

},{"./app":2,"./queryParser":6,"./wiki":13}],10:[function(require,module,exports){
/// <reference path="codemirror/codemirror.d.ts" />
var CodeMirror = require("codemirror");
var richTextEditor_1 = require("./richTextEditor");
var microReact_1 = require("./microReact");
var app_1 = require("./app");
var queryParser_1 = require("./queryParser");
var utils_1 = require("./utils");
var PANE;
(function (PANE) {
    PANE[PANE["FULL"] = 0] = "FULL";
    PANE[PANE["WINDOW"] = 1] = "WINDOW";
    PANE[PANE["POPOUT"] = 2] = "POPOUT";
})(PANE || (PANE = {}));
;
var BLOCK;
(function (BLOCK) {
    BLOCK[BLOCK["TEXT"] = 0] = "TEXT";
    BLOCK[BLOCK["PROJECTION"] = 1] = "PROJECTION";
})(BLOCK || (BLOCK = {}));
;
exports.uiState = {
    widget: {
        search: {}
    }
};
//---------------------------------------------------------
// Utils
//---------------------------------------------------------
//---------------------------------------------------------
// Dispatches
//---------------------------------------------------------
app_1.handle("ui focus search", function (changes, _a) {
    var paneId = _a.paneId, value = _a.value;
    var state = exports.uiState.widget.search[paneId] = exports.uiState.widget.search[paneId] || { value: value };
    state.focused = true;
});
app_1.handle("ui set search", function (changes, _a) {
    var paneId = _a.paneId, value = _a.value;
    var state = exports.uiState.widget.search[paneId] = exports.uiState.widget.search[paneId] || { value: value };
    state.value = value;
    state.focused = false;
    var fact = utils_1.copy(app_1.eve.findOne("ui pane", { pane: paneId }));
    fact.__id = undefined;
    fact.contains = value;
    changes.remove("ui pane", { pane: paneId })
        .add("ui pane", fact);
    if (!app_1.eve.findOne("display name", { name: value }))
        app_1.activeSearches[value] = queryParser_1.queryToExecutable(value);
});
app_1.handle("ui toggle search plan", function (changes, _a) {
    var paneId = _a.paneId;
    var state = exports.uiState.widget.search[paneId] = exports.uiState.widget.search[paneId] || { value: "" };
    state.plan = !state.plan;
});
app_1.handle("add sourced eav", function (changes, eav) {
    changes.add("sourced eav", eav);
});
app_1.handle("remove sourced eav", function (changes, eav) {
    changes.remove("sourced eav", eav);
});
app_1.handle("update page", function (changes, _a) {
    var page = _a.page, content = _a.content;
    changes.remove("page content", { page: page });
    changes.add("page content", { page: page, content: content });
});
//---------------------------------------------------------
// Wiki Containers
//---------------------------------------------------------
function root() {
    var panes = [];
    for (var _i = 0, _a = app_1.eve.find("ui pane"); _i < _a.length; _i++) {
        var paneId = _a[_i].pane;
        panes.push(pane(paneId));
    }
    return { c: "wiki-root", id: "root", children: panes };
}
exports.root = root;
// @TODO: Add search functionality + Pane Chrome
var paneChrome = (_a = {},
    _a[PANE.FULL] = function (paneId, entityId) { return ({
        c: "fullscreen",
        header: { t: "header", c: "flex-row", children: [{ c: "logo eve-logo" }, searchInput(paneId, entityId)] }
    }); },
    _a[PANE.POPOUT] = function (paneId, entityId) { return ({
        c: "window",
        header: { t: "header", c: "flex-row", children: [
                { c: "flex-grow title", text: entityId },
                { c: "flex-row controls", children: [{ c: "ion-close-round" }] }
            ] }
    }); },
    _a[PANE.WINDOW] = function (paneId, entityId) { return ({
        c: "window",
        header: { t: "header", c: "flex-row", children: [
                { c: "flex-grow title", text: entityId },
                { c: "flex-row controls", children: [
                        { c: "ion-android-search" },
                        { c: "ion-minus-round" },
                        { c: "ion-close-round" }
                    ] }
            ] }
    }); },
    _a
);
function pane(paneId) {
    // @FIXME: Add kind to ui panes
    var _a = app_1.eve.findOne("ui pane", { pane: paneId }) || {}, _b = _a.contains, contains = _b === void 0 ? undefined : _b, _c = _a.kind, kind = _c === void 0 ? PANE.FULL : _c;
    var makeChrome = paneChrome[kind];
    if (!makeChrome)
        throw new Error("Unknown pane kind: '" + kind + "' (" + PANE[kind] + ")");
    var _d = makeChrome(paneId, contains), klass = _d.c, header = _d.header, footer = _d.footer;
    var content;
    var display = app_1.eve.findOne("display name", { name: contains }) || app_1.eve.findOne("display name", { id: contains });
    if (display)
        content = entity(display.id, paneId);
    else if (app_1.activeSearches[contains] && app_1.activeSearches[contains].plan.length > 1)
        content = search(contains, paneId);
    else
        content = { text: "No results found..." }; // @ TODO: Editor to create new entity
    return { c: "wiki-pane " + (klass || ""), children: [header, content, footer] };
}
exports.pane = pane;
function search(search, paneId) {
    var _a = app_1.activeSearches[search], tokens = _a.tokens, plan = _a.plan, executable = _a.executable;
    // figure out what the headers are
    var headers = [];
    for (var _i = 0; _i < plan.length; _i++) {
        var step = plan[_i];
        var name_1 = step.name;
        if (step.size === 0 || step.type === queryParser_1.StepType.FILTERBYENTITY || step.type === queryParser_1.StepType.INTERSECT)
            continue;
        if (step.type === queryParser_1.StepType.GATHER)
            name_1 = app_1.eve.findOne("display name", { id: name_1 }).name;
        headers.push({ c: "column field", value: step.name, text: name_1 });
    }
    // figure out what fields are grouped, if any
    var groupedFields = {};
    for (var _b = 0; _b < plan.length; _b++) {
        var step = plan[_b];
        if (step.type === queryParser_1.StepType.GROUP)
            groupedFields[step.subjectNode.name] = true;
        else if (step.type === queryParser_1.StepType.AGGREGATE)
            groupedFields[step.name] = true;
    }
    var results = executable.exec();
    var groupInfo = results.groupInfo;
    var planLength = plan.length;
    var isBit = planLength > 1;
    var groups = [];
    nextResult: for (var ix = 0, len = results.unprojected.length; ix < len; ix += executable.unprojectedSize) {
        if (groupInfo && ix > groupInfo.length)
            break;
        if (groupInfo && groupInfo[ix] === undefined)
            continue;
        var group = void 0;
        if (!groupInfo)
            groups.push(group = { c: "group", children: [] });
        else if (!groups[groupInfo[ix]])
            groups[groupInfo[ix]] = group = { c: "group", children: [] };
        else
            group = groups[groupInfo[ix]];
        var offset = 0;
        for (var stepIx = 0; stepIx < planLength; stepIx++) {
            var step = plan[stepIx];
            if (!step.size)
                continue;
            var chunk = results.unprojected[ix + offset + step.size - 1];
            if (!chunk)
                continue nextResult;
            offset += step.size;
            var text = void 0, link = void 0, kind = void 0, click;
            if (step.type === queryParser_1.StepType.GATHER) {
                text = app_1.eve.findOne("display name", { id: chunk["entity"] }).name;
                link = chunk["entity"];
                kind = "entity";
            }
            else if (step.type === queryParser_1.StepType.LOOKUP) {
                text = chunk["value"];
                kind = "attribute";
            }
            else if (step.type === queryParser_1.StepType.AGGREGATE) {
                text = chunk[step.subject];
                kind = "value";
            }
            else if (step.type = queryParser_1.StepType.CALCULATE) {
                text = JSON.stringify(chunk.result);
                kind = "value";
            }
            else if (step.type === queryParser_1.StepType.FILTERBYENTITY || step.type === queryParser_1.StepType.INTERSECT) {
            }
            else
                text = JSON.stringify(chunk);
            if (text === undefined)
                continue;
            var item = { id: paneId + " " + ix + " " + stepIx, c: "field " + kind, text: text, data: { paneId: paneId }, link: link, click: link ? navigate : undefined };
            if (!group.children[stepIx])
                group.children[stepIx] = { c: "column", value: step.name, children: [item] };
            else if (!groupedFields[step.name])
                group.children[stepIx].children.push(item);
            if (planLength === 1)
                group.c = "list-row"; // @FIXME: Is this still needed?
        }
    }
    // @TODO: Without this ID, a bug occurs when reusing elements that injects a text node containing "undefined" after certain scenarios.
    groups.unshift({ t: "header", id: paneId + "|header", c: "flex-row", children: headers });
    return { t: "content", c: "wiki-search", key: JSON.stringify(results.unprojected), children: [{ id: paneId + "|table", c: "results table", children: groups }], };
}
exports.search = search;
function sizeColumns(node, elem) {
    // @FIXME: Horrible hack to get around randomly added "undefined" text node that's coming from in microreact.
    var cur = node;
    while (cur.parentElement)
        cur = cur.parentElement;
    if (cur.tagName !== "HTML")
        document.body.appendChild(cur);
    var child, ix = 0;
    var widths = {};
    var columns = node.querySelectorAll(".column");
    for (var _i = 0; _i < columns.length; _i++) {
        var column = columns[_i];
        column.style.width = "auto";
        widths[column["value"]] = widths[column["value"]] || 0;
        if (column.offsetWidth > widths[column["value"]])
            widths[column["value"]] = column.offsetWidth;
    }
    for (var _a = 0; _a < columns.length; _a++) {
        var column = columns[_a];
        column.style.width = widths[column["value"]] + 1;
    }
    if (cur.tagName !== "HTML")
        document.body.removeChild(cur);
}
//---------------------------------------------------------
// CHRIS
//---------------------------------------------------------
function parseParams(rawParams) {
    var params = {};
    if (!rawParams)
        return params;
    for (var _i = 0, _a = rawParams.split(";"); _i < _a.length; _i++) {
        var kv = _a[_i];
        var _b = kv.split("="), key = _b[0], value = _b[1];
        params[key.trim()] = utils_1.coerceInput(value.trim());
    }
    return params;
}
function getEmbed(meta, query) {
    var _a = query.split("|"), content = _a[0], rawParams = _a[1];
    var node = document.createElement("span");
    var link;
    node.textContent = content;
    var params = parseParams(rawParams);
    var contentDisplay = app_1.eve.findOne("display name", { id: content });
    // @TODO: Figure out what to do for {age: {current year - birth year}}
    if (params["eav source"]) {
        // Attribute reference
        node.classList.add("attribute");
        var eav = app_1.eve.findOne("sourced eav", { source: params["eav source"] });
        if (!eav) {
            node.classList.add("invalid");
        }
        else {
            var attribute = eav.attribute, value = eav.value;
            var display = app_1.eve.findOne("display name", { id: value });
            if (attribute === "is a" || display) {
                link = value;
            }
            node.textContent = display ? display.name : value;
        }
    }
    else if (contentDisplay) {
        // Entity reference
        node.classList.add("entity");
        node.textContent = contentDisplay.name;
        link = content;
    }
    else {
        // Embedded queries
        node.classList.add("query");
        // @FIXME: Horrible kludge, need a microReact.compile(...)
        var subRenderer = new microReact_1.Renderer();
        subRenderer.render([{ id: "root", children: [search(content, meta.paneId)] }]);
        node = subRenderer.content;
    }
    if (link) {
        node.classList.add("link");
        node.onclick = function () {
            app_1.dispatch("ui set search", { paneId: meta.paneId, value: link }).commit();
        };
    }
    return node;
}
function getInline(meta, query) {
    var _a = query.slice(1, -1).split("|"), content = _a[0], rawParams = _a[1];
    var params = parseParams(rawParams);
    if (content.indexOf(":") > -1) {
        var sourceId = utils_1.uuid();
        var entity_1 = meta.entity;
        var _b = query.substring(1, query.length - 1).split(":"), attribute = _b[0], value = _b[1];
        value = utils_1.coerceInput(value.trim());
        var display = app_1.eve.findOne("display name", { name: value });
        if (display) {
            value = display.id;
        }
        app_1.dispatch("add sourced eav", { entity: entity_1, attribute: attribute, value: value, source: sourceId }).commit();
        return "{" + entity_1 + "'s " + attribute + "|eav source = " + sourceId + "}";
    }
    else if (!params["eav source"]) {
        app_1.activeSearches[content] = queryParser_1.queryToExecutable(content);
    }
    return query;
}
function removeInline(meta, query) {
    var _a = query.substring(1, query.length - 1).split("|"), search = _a[0], rawParams = _a[1];
    var params = parseParams(rawParams);
    var source = params["eav source"];
    if (source && app_1.eve.findOne("sourced eav", { source: source })) {
        app_1.dispatch("remove sourced eav", { entity: meta.entity, source: source }).commit();
    }
    else {
    }
}
var wikiEditor = richTextEditor_1.createEditor(getEmbed, getInline, removeInline);
//---------------------------------------------------------
function entity(entityId, paneId) {
    var content = app_1.eve.findOne("entity", { entity: entityId })["content"];
    var page = app_1.eve.findOne("entity page", { entity: entityId })["page"];
    // @TODO: Move these into blocks
    //   if(eve.findOne("collection", {collection: entityId})) blocks.push({id: `${paneId}|index`, c: "wiki-block", children: [index({collectionId: entityId, data: {paneId}, click: navigate})]});
    //   blocks.push({id: `${paneId}|related`, c: "wiki-block", children: [related({entityId, data: {paneId}, click: navigate})]});
    return { t: "content", c: "wiki-entity", children: [
            { c: "wiki-editor", postRender: wikiEditor, change: updatePage, meta: { entity: entityId, page: page, paneId: paneId }, value: content }
        ] };
}
exports.entity = entity;
function updatePage(meta, content) {
    app_1.dispatch("update page", { page: meta.page, content: content }).commit();
}
function navigate(event, elem) {
    var paneId = elem.data.paneId;
    app_1.dispatch("ui set search", { paneId: paneId, value: elem.link }).commit();
}
//---------------------------------------------------------
// Wiki Widgets
//---------------------------------------------------------
function searchInput(paneId, value) {
    var display = app_1.eve.findOne("display name", { id: value });
    var name = value;
    if (display) {
        name = display.name;
    }
    var state = exports.uiState.widget.search[paneId] || { focused: false, plan: false };
    return {
        c: "flex-grow wiki-search-wrapper",
        children: [
            codeMirrorElement({
                c: "flex-grow wiki-search-input " + (state.focused ? "selected" : ""),
                paneId: paneId,
                value: name,
                focus: focusSearch,
                blur: setSearch,
                // change: updateSearch,
                shortcuts: { "Enter": setSearch }
            }),
            { c: "controls", children: [
                    { c: "ion-ios-arrow-" + (state.plan ? 'up' : 'down') + " plan", click: toggleSearchPlan, paneId: paneId },
                    // while technically a button, we don't need to do anything as clicking it will blur the editor
                    // which will execute the search
                    { c: "ion-android-search visible", paneId: paneId }
                ] },
        ]
    };
}
exports.searchInput = searchInput;
;
function focusSearch(event, elem) {
    app_1.dispatch("ui focus search", elem).commit();
}
function setSearch(event, elem) {
    app_1.dispatch("ui set search", { paneId: elem.paneId, value: event.value }).commit();
}
function updateSearch(event, elem) {
    app_1.dispatch("ui update search", elem).commit();
}
function toggleSearchPlan(event, elem) {
    console.log("toggle search plan", elem);
    app_1.dispatch("ui toggle search plan", elem).commit();
}
function index(elem) {
    var facts = app_1.eve.find("is a attributes", { collection: elem.collectionId });
    var click = elem.click;
    delete elem.click;
    elem.t = "p";
    elem.children = [
        { t: "h2", text: "There " + pluralize("are", facts.length) + " " + facts.length + " " + pluralize(elem.collectionId, facts.length) + ":" },
        { t: "ul", children: facts.map(function (fact) { return ({ t: "li", c: "entity link", text: fact.entity, data: elem.data, link: fact.entity, click: click }); }) }
    ];
    return elem;
}
exports.index = index;
function related(elem) {
    var facts = app_1.eve.find("directionless links", { entity: elem.entityId });
    elem.t = "p";
    elem.c = "flex-row flex-wrap csv" + (elem.c || "");
    var click = elem.click;
    delete elem.click;
    if (facts.length)
        elem.children = [
            { t: "h2", text: elem.entityId + " is related to:" },
        ].concat(facts.map(function (fact) { return ({ c: "entity link", text: fact.link, data: elem.data, link: fact.link, click: click }); }));
    else
        elem.text = elem.entityId + " is not related to any other entities.";
    return elem;
}
exports.related = related;
;
function codeMirrorElement(elem) {
    elem.postRender = codeMirrorPostRender(elem.postRender);
    return elem;
}
exports.codeMirrorElement = codeMirrorElement;
var _codeMirrorPostRenderMemo = {};
function handleCMEvent(handler, elem) {
    return function (cm) {
        var evt = (new CustomEvent("CMEvent"));
        evt.editor = cm;
        evt.value = cm.getDoc().getValue();
        handler(evt, elem);
    };
}
function codeMirrorPostRender(postRender) {
    var key = postRender ? postRender.toString() : "";
    if (_codeMirrorPostRenderMemo[key])
        return _codeMirrorPostRenderMemo[key];
    return _codeMirrorPostRenderMemo[key] = function (node, elem) {
        var cm = node.cm;
        if (!cm) {
            var extraKeys = {};
            if (elem.shortcuts) {
                for (var shortcut in elem.shortcuts)
                    extraKeys[shortcut] = handleCMEvent(elem.shortcuts[shortcut], elem);
            }
            cm = node.cm = CodeMirror(node, {
                lineWrapping: elem.lineWrapping !== false ? true : false,
                lineNumbers: elem.lineNumbers,
                mode: elem.mode || "gfm",
                extraKeys: extraKeys
            });
            if (elem.change)
                cm.on("change", handleCMEvent(elem.change, elem));
            if (elem.blur)
                cm.on("blur", handleCMEvent(elem.blur, elem));
            if (elem.focus)
                cm.on("focus", handleCMEvent(elem.focus, elem));
            if (elem.autofocus)
                cm.focus();
        }
        if (cm.getDoc().getValue() !== elem.value)
            cm.setValue(elem.value || "");
        if (postRender)
            postRender(node, elem);
    };
}
// @NOTE: Uncomment this to enable the new UI, or type `window["NEUE_UI"] = true; app.render()` into the console to enable it transiently.
window["NEUE_UI"] = true;
var _a;

},{"./app":2,"./microReact":4,"./queryParser":6,"./richTextEditor":7,"./utils":12,"codemirror":1}],11:[function(require,module,exports){
var utils_1 = require("./utils");
var runtime_1 = require("./runtime");
function resolve(table, fact) {
    var neue = {};
    for (var field in fact)
        neue[(table + ": " + field)] = fact[field];
    return neue;
}
function humanize(table, fact) {
    var neue = {};
    for (var field in fact)
        neue[field.slice(table.length + 2)] = fact[field];
    return neue;
}
function resolvedAdd(changeset, table, fact) {
    return changeset.add(table, resolve(table, fact));
}
function resolvedRemove(changeset, table, fact) {
    return changeset.remove(table, resolve(table, fact));
}
function humanizedFind(ixer, table, query) {
    var results = [];
    for (var _i = 0, _a = ixer.find(table, resolve(table, query)); _i < _a.length; _i++) {
        var fact = _a[_i];
        results.push(humanize(table, fact));
    }
    var diag = {};
    for (var table_1 in ixer.tables)
        diag[table_1] = ixer.tables[table_1].table.length;
    return results;
}
var UI = (function () {
    function UI(id) {
        this.id = id;
        this._children = [];
        this._attributes = {};
        this._events = {};
    }
    UI.remove = function (template, ixer) {
        var changeset = ixer.diff();
        resolvedRemove(changeset, "ui template", { template: template });
        resolvedRemove(changeset, "ui template binding", { template: template });
        var bindings = humanizedFind(ixer, "ui template binding", { template: template });
        for (var _i = 0; _i < bindings.length; _i++) {
            var binding = bindings[_i];
            changeset.merge(runtime_1.Query.remove(binding.binding, ixer));
        }
        resolvedRemove(changeset, "ui embed", { template: template });
        var embeds = humanizedFind(ixer, "ui embed", { template: template });
        for (var _a = 0; _a < embeds.length; _a++) {
            var embed = embeds[_a];
            resolvedRemove(changeset, "ui embed scope", { template: template, embed: embed.embed });
            resolvedRemove(changeset, "ui embed scope binding", { template: template, embed: embed.embed });
        }
        resolvedRemove(changeset, "ui attribute", { template: template });
        resolvedRemove(changeset, "ui attribute binding", { template: template });
        resolvedRemove(changeset, "ui event", { template: template });
        var events = humanizedFind(ixer, "ui event", { template: template });
        for (var _b = 0; _b < events.length; _b++) {
            var event_1 = events[_b];
            resolvedRemove(changeset, "ui event state", { template: template, event: event_1.event });
            resolvedRemove(changeset, "ui event state binding", { template: template, event: event_1.event });
        }
        for (var _c = 0, _d = humanizedFind(ixer, "ui template", { parent: template }); _c < _d.length; _c++) {
            var child = _d[_c];
            changeset.merge(UI.remove(child.template, ixer));
        }
        return changeset;
    };
    UI.prototype.copy = function () {
        var neue = new UI(this.id);
        neue._binding = this._binding;
        neue._embedded = this._embedded;
        neue._children = this._children;
        neue._attributes = this._attributes;
        neue._events = this._events;
        neue._parent = this._parent;
        return neue;
    };
    UI.prototype.changeset = function (ixer) {
        var changeset = ixer.diff();
        var parent = this._attributes["parent"] || (this._parent && this._parent.id) || "";
        var ix = this._attributes["ix"];
        if (ix === undefined)
            ix = (this._parent && this._parent._children.indexOf(this));
        if (ix === -1 || ix === undefined)
            ix = "";
        if (this._embedded)
            parent = "";
        resolvedAdd(changeset, "ui template", { template: this.id, parent: parent, ix: ix });
        if (this._binding) {
            if (!this._binding.name || this._binding.name === "unknown")
                this._binding.name = "bound view " + this.id;
            changeset.merge(this._binding.changeset(ixer));
            resolvedAdd(changeset, "ui template binding", { template: this.id, binding: this._binding.name });
        }
        if (this._embedded) {
            var embed = utils_1.uuid();
            resolvedAdd(changeset, "ui embed", { embed: embed, template: this.id, parent: (this._parent || {}).id, ix: ix });
            for (var key in this._embedded) {
                var value = this._attributes[key];
                if (value instanceof Array)
                    resolvedAdd(changeset, "ui embed scope binding", { embed: embed, key: key, source: value[0], alias: value[1] });
                else
                    resolvedAdd(changeset, "ui embed scope", { embed: embed, key: key, value: value });
            }
        }
        for (var property in this._attributes) {
            var value = this._attributes[property];
            if (value instanceof Array)
                resolvedAdd(changeset, "ui attribute binding", { template: this.id, property: property, source: value[0], alias: value[1] });
            else
                resolvedAdd(changeset, "ui attribute", { template: this.id, property: property, value: value });
        }
        for (var event_2 in this._events) {
            resolvedAdd(changeset, "ui event", { template: this.id, event: event_2 });
            var state = this._events[event_2];
            for (var key in state) {
                var value = state[key];
                if (value instanceof Array)
                    resolvedAdd(changeset, "ui event state binding", { template: this.id, event: event_2, key: key, source: value[0], alias: value[1] });
                else
                    resolvedAdd(changeset, "ui event state", { template: this.id, event: event_2, key: key, value: value });
            }
        }
        for (var _i = 0, _a = this._children; _i < _a.length; _i++) {
            var child = _a[_i];
            changeset.merge(child.changeset(ixer));
        }
        return changeset;
    };
    UI.prototype.load = function (template, ixer, parent) {
        var fact = humanizedFind(ixer, "ui template", { template: template })[0];
        if (!fact)
            return this;
        if (parent || fact.parent)
            this._parent = parent || new UI(this._parent);
        var binding = humanizedFind(ixer, "ui template binding", { template: template })[0];
        if (binding)
            this.bind((new runtime_1.Query(ixer, binding.binding)));
        var embed = humanizedFind(ixer, "ui embed", { template: template, parent: this._parent ? this._parent.id : "" })[0];
        if (embed) {
            var scope = {};
            for (var _i = 0, _a = humanizedFind(ixer, "ui embed scope", { embed: embed.embed }); _i < _a.length; _i++) {
                var attr = _a[_i];
                scope[attr.key] = attr.value;
            }
            for (var _b = 0, _c = humanizedFind(ixer, "ui embed scope binding", { embed: embed.embed }); _b < _c.length; _b++) {
                var attr = _c[_b];
                scope[attr.key] = [attr.source, attr.alias];
            }
            this.embed(scope);
        }
        for (var _d = 0, _e = humanizedFind(ixer, "ui attribute", { template: template }); _d < _e.length; _d++) {
            var attr = _e[_d];
            this.attribute(attr.property, attr.value);
        }
        for (var _f = 0, _g = humanizedFind(ixer, "ui attribute binding", { template: template }); _f < _g.length; _f++) {
            var attr = _g[_f];
            this.attribute(attr.property, [attr.source, attr.alias]);
        }
        for (var _h = 0, _j = humanizedFind(ixer, "ui event", { template: template }); _h < _j.length; _h++) {
            var event_3 = _j[_h];
            var state = {};
            for (var _k = 0, _l = humanizedFind(ixer, "ui event state", { template: template, event: event_3.event }); _k < _l.length; _k++) {
                var attr = _l[_k];
                state[event_3.key] = event_3.value;
            }
            for (var _m = 0, _o = humanizedFind(ixer, "ui event state binding", { template: template, event: event_3.event }); _m < _o.length; _m++) {
                var attr = _o[_m];
                state[event_3.key] = [event_3.source, event_3.alias];
            }
            this.event(event_3.event, state);
        }
        for (var _p = 0, _q = humanizedFind(ixer, "ui template", { parent: template }); _p < _q.length; _p++) {
            var child = _q[_p];
            this.child((new UI(child.template)).load(child.template, ixer, this));
        }
        return this;
    };
    UI.prototype.children = function (neue, append) {
        if (append === void 0) { append = false; }
        if (!neue)
            return this._children;
        if (!append)
            this._children.length = 0;
        for (var _i = 0; _i < neue.length; _i++) {
            var child = neue[_i];
            var copied = child.copy();
            copied._parent = this;
            this._children.push(copied);
        }
        return this._children;
    };
    UI.prototype.child = function (child, ix, embed) {
        child = child.copy();
        child._parent = this;
        if (embed)
            child.embed(embed);
        if (!ix)
            this._children.push(child);
        else
            this._children.splice(ix, 0, child);
        return child;
    };
    UI.prototype.removeChild = function (ix) {
        return this._children.splice(ix, 1);
    };
    UI.prototype.attributes = function (properties, merge) {
        if (merge === void 0) { merge = false; }
        if (!properties)
            return this._attributes;
        if (!merge) {
            for (var prop in this._attributes)
                delete this._attributes[prop];
        }
        for (var prop in properties)
            this._attributes[prop] = properties[prop];
        return this;
    };
    UI.prototype.attribute = function (property, value) {
        if (value === undefined)
            return this._attributes[property];
        this._attributes[property] = value;
        return this;
    };
    UI.prototype.removeAttribute = function (property) {
        delete this._attributes[property];
        return this;
    };
    UI.prototype.events = function (events, merge) {
        if (merge === void 0) { merge = false; }
        if (!events)
            return this._events;
        if (!merge) {
            for (var event_4 in this._events)
                delete this._events[event_4];
        }
        for (var event_5 in events)
            this._events[event_5] = events[event_5];
        return this;
    };
    UI.prototype.event = function (event, state) {
        if (state === undefined)
            return this._events[event];
        this._attributes[event] = state;
        return this;
    };
    UI.prototype.removeEvent = function (event) {
        delete this._events[event];
        return this;
    };
    UI.prototype.embed = function (scope) {
        if (scope === void 0) { scope = {}; }
        if (!scope) {
            this._embedded = undefined;
            return this;
        }
        if (scope === true)
            scope = {};
        this._embedded = scope;
        return this;
    };
    UI.prototype.bind = function (binding) {
        this._binding = binding;
        return this;
    };
    return UI;
})();
exports.UI = UI;
// @TODO: Finish reference impl.
// @TODO: Then build bit-generating version
var UIRenderer = (function () {
    function UIRenderer(ixer) {
        this.ixer = ixer;
        this.compiled = 0;
        this._tagCompilers = {};
        this._handlers = [];
    }
    UIRenderer.prototype.compile = function (roots) {
        if (utils_1.DEBUG.RENDERER)
            console.group("ui compile");
        var compiledElems = [];
        for (var _i = 0; _i < roots.length; _i++) {
            var root = roots[_i];
            // @TODO: reparent dynamic roots if needed.
            if (typeof root === "string") {
                var elems = this._compileWrapper(root, compiledElems.length);
                compiledElems.push.apply(compiledElems, elems);
                var base = this.ixer.findOne("ui template", { "ui template: template": root });
                if (!base)
                    continue;
                var parent_1 = base["ui template: parent"];
                if (parent_1) {
                    for (var _a = 0; _a < elems.length; _a++) {
                        var elem = elems[_a];
                        elem.parent = parent_1;
                    }
                }
            }
            else {
                if (!root.ix)
                    root.ix = compiledElems.length;
                compiledElems.push(root);
            }
        }
        if (utils_1.DEBUG.RENDERER)
            console.groupEnd();
        return compiledElems;
    };
    UIRenderer.prototype._compileWrapper = function (template, baseIx, constraints, bindingStack, depth) {
        if (constraints === void 0) { constraints = {}; }
        if (bindingStack === void 0) { bindingStack = []; }
        if (depth === void 0) { depth = 0; }
        var elems = [];
        var binding = this.ixer.findOne("ui template binding", { "ui template binding: template": template });
        if (!binding) {
            var elem = this._compileElement(template, bindingStack, depth);
            if (elem)
                elems[0] = elem;
        }
        else {
            var boundQuery = binding["ui template binding: binding"];
            var facts = this.getBoundFacts(boundQuery, constraints);
            var ix = 0;
            for (var _i = 0; _i < facts.length; _i++) {
                var fact = facts[_i];
                bindingStack.push(fact);
                var elem = this._compileElement(template, bindingStack, depth);
                bindingStack.pop();
                if (elem)
                    elems.push(elem);
            }
        }
        elems.sort(function (a, b) { return a.ix - b.ix; });
        var prevIx = undefined;
        for (var _a = 0; _a < elems.length; _a++) {
            var elem = elems[_a];
            elem.ix = elem.ix ? elem.ix + baseIx : baseIx;
            if (elem.ix === prevIx)
                elem.ix++;
            prevIx = elem.ix;
        }
        return elems;
    };
    UIRenderer.prototype._compileElement = function (template, bindingStack, depth) {
        if (utils_1.DEBUG.RENDERER)
            console.log(utils_1.repeat("  ", depth) + "* compile", template);
        var elementToChildren = this.ixer.index("ui template", ["ui template: parent"]);
        var elementToEmbeds = this.ixer.index("ui embed", ["ui embed: parent"]);
        var embedToScope = this.ixer.index("ui embed scope", ["ui embed scope: embed"]);
        var embedToScopeBinding = this.ixer.index("ui embed scope binding", ["ui embed scope binding: embed"]);
        var elementToAttrs = this.ixer.index("ui attribute", ["ui attribute: template"]);
        var elementToAttrBindings = this.ixer.index("ui attribute binding", ["ui attribute binding: template"]);
        var elementToEvents = this.ixer.index("ui event", ["ui event: template"]);
        this.compiled++;
        var base = this.ixer.findOne("ui template", { "ui template: template": template });
        if (!base) {
            console.warn("ui template " + template + " does not exist. Ignoring.");
            return undefined;
        }
        var attrs = elementToAttrs[template];
        var boundAttrs = elementToAttrBindings[template];
        var events = elementToEvents[template];
        // Handle meta properties
        var elem = { _template: template, ix: base["ui template: ix"] };
        // Handle static properties
        if (attrs) {
            for (var _i = 0; _i < attrs.length; _i++) {
                var _a = attrs[_i], prop = _a["ui attribute: property"], val = _a["ui attribute: value"];
                elem[prop] = val;
            }
        }
        // Handle bound properties
        if (boundAttrs) {
            // @FIXME: What do with source?
            for (var _b = 0; _b < boundAttrs.length; _b++) {
                var _c = boundAttrs[_b], prop = _c["ui attribute binding: property"], source = _c["ui attribute binding: source"], alias = _c["ui attribute binding: alias"];
                elem[prop] = this.getBoundValue(source, alias, bindingStack);
            }
        }
        // Attach event handlers
        if (events) {
            for (var _d = 0; _d < events.length; _d++) {
                var event_6 = events[_d]["ui event: event"];
                elem[event_6] = this.generateEventHandler(elem, event_6, bindingStack);
            }
        }
        // Compile children
        var children = elementToChildren[template] || [];
        var embeds = elementToEmbeds[template] || [];
        if (children.length || embeds.length) {
            elem.children = [];
            var childIx = 0, embedIx = 0;
            while (childIx < children.length || embedIx < embeds.length) {
                var child = children[childIx];
                var embed = embeds[embedIx];
                var add = void 0, constraints = {}, childBindingStack = bindingStack;
                if (!embed || child && child.ix <= embed.ix) {
                    add = children[childIx++]["ui template: template"];
                    // Resolve bound aliases into constraints
                    constraints = this.getBoundScope(bindingStack);
                }
                else {
                    add = embeds[embedIx++]["ui embed: template"];
                    for (var _e = 0, _f = embedToScope[embed["ui embed: embed"]] || []; _e < _f.length; _e++) {
                        var scope = _f[_e];
                        constraints[scope["ui embed scope: key"]] = scope["ui embed scope: value"];
                    }
                    for (var _g = 0, _h = embedToScopeBinding[embed["ui embed: embed"]] || []; _g < _h.length; _g++) {
                        var scope = _h[_g];
                        // @FIXME: What do about source?
                        var key = scope["ui embed scope binding: key"], source = scope["ui embed scope binding: source"], alias = scope["ui embed scope binding: alias"];
                        constraints[key] = this.getBoundValue(source, alias, bindingStack);
                    }
                    childBindingStack = [constraints];
                }
                elem.children.push.apply(elem.children, this._compileWrapper(add, elem.children.length, constraints, childBindingStack, depth + 1));
            }
        }
        if (this._tagCompilers[elem.t]) {
            try {
                this._tagCompilers[elem.t](elem);
            }
            catch (err) {
                console.warn("Failed to compile template: '" + template + "' due to '" + err + "' for element '" + JSON.stringify(elem) + "'");
                elem.t = "ui-error";
            }
        }
        return elem;
    };
    UIRenderer.prototype.getBoundFacts = function (query, constraints) {
        return this.ixer.find(query, constraints);
    };
    UIRenderer.prototype.getBoundScope = function (bindingStack) {
        var scope = {};
        for (var _i = 0; _i < bindingStack.length; _i++) {
            var fact = bindingStack[_i];
            for (var alias in fact)
                scope[alias] = fact[alias];
        }
        return scope;
    };
    //@FIXME: What do about source?
    UIRenderer.prototype.getBoundValue = function (source, alias, bindingStack) {
        for (var ix = bindingStack.length - 1; ix >= 0; ix--) {
            var fact = bindingStack[ix];
            if (source in fact && fact[alias])
                return fact[alias];
        }
    };
    UIRenderer.prototype.generateEventHandler = function (elem, event, bindingStack) {
        var template = elem["_template"];
        var memoKey = template + "::" + event;
        var attrKey = event + "::state";
        elem[attrKey] = this.getEventState(template, event, bindingStack);
        if (this._handlers[memoKey])
            return this._handlers[memoKey];
        var self = this;
        if (event === "change" || event === "input") {
            this._handlers[memoKey] = function (evt, elem) {
                var props = {};
                if (elem.t === "select" || elem.t === "input" || elem.t === "textarea")
                    props.value = evt.target.value;
                if (elem.type === "checkbox")
                    props.value = evt.target.checked;
                self.handleEvent(template, event, evt, elem, props);
            };
        }
        else {
            this._handlers[memoKey] = function (evt, elem) {
                self.handleEvent(template, event, evt, elem, {});
            };
        }
        return this._handlers[memoKey];
    };
    UIRenderer.prototype.handleEvent = function (template, eventName, event, elem, eventProps) {
        var attrKey = eventName + "::state";
        var state = elem[attrKey];
        var content = (_a = ["\n      # ", " ({is a: event})\n      ## Meta\n      event target: {event target: ", "}\n      event template: {event template: ", "}\n      event type: {event type: ", "}\n\n      ## State\n    "], _a.raw = ["\n      # ", " ({is a: event})\n      ## Meta\n      event target: {event target: ", "}\n      event template: {event template: ", "}\n      event type: {event type: ", "}\n\n      ## State\n    "], utils_1.unpad(6)(_a, eventName, elem.id, template, eventName));
        if (state["*event*"]) {
            for (var prop in state["*event*"])
                content += prop + ": {" + prop + ": " + eventProps[state["*event*"][prop]] + "}\n";
        }
        for (var prop in state) {
            if (prop === "*event*")
                continue;
            content += prop + ": {" + prop + ": " + state[prop] + "}\n";
        }
        var changeset = this.ixer.diff();
        var raw = utils_1.uuid();
        var entity = eventName + " event " + raw.slice(-12);
        changeset.add("builtin entity", { entity: entity, content: content });
        this.ixer.applyDiff(changeset);
        console.log(entity);
        var _a;
    };
    UIRenderer.prototype.getEventState = function (template, event, bindingStack) {
        var state = {};
        var staticAttrs = this.ixer.find("ui event state", { "ui event state: template": template, "ui event state: event": event });
        for (var _i = 0; _i < staticAttrs.length; _i++) {
            var _a = staticAttrs[_i], key = _a["ui event state: key"], val = _a["ui event state: value"];
            state[key] = val;
        }
        var boundAttrs = this.ixer.find("ui event state binding", { "ui event state binding: template": template, "ui event state binding: event": event });
        for (var _b = 0; _b < boundAttrs.length; _b++) {
            var _c = boundAttrs[_b], key = _c["ui event state binding: key"], source = _c["ui event state binding: source"], alias = _c["ui event state binding: alias"];
            if (source === "*event*") {
                state["*event*"] = state["*event*"] || {};
                state["*event*"][key] = alias;
            }
            else {
                state[key] = this.getBoundValue(source, alias, bindingStack);
            }
        }
        return state;
    };
    return UIRenderer;
})();
exports.UIRenderer = UIRenderer;
if (this.window)
    window["uiRenderer"] = exports;

},{"./runtime":8,"./utils":12}],12:[function(require,module,exports){
var uuid_1 = require("../vendor/uuid");
exports.uuid = uuid_1.v4;
exports.ENV = "browser";
try {
    window;
}
catch (err) {
    exports.ENV = "node";
}
exports.DEBUG = {};
if (exports.ENV === "browser")
    window["DEBUG"] = exports.DEBUG;
exports.unpad = function (indent) {
    if (exports.unpad.memo[indent])
        return exports.unpad.memo[indent];
    return exports.unpad.memo[indent] = function (strings) {
        var values = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            values[_i - 1] = arguments[_i];
        }
        if (!strings.length)
            return;
        var res = "";
        var ix = 0;
        for (var _a = 0; _a < strings.length; _a++) {
            var str = strings[_a];
            res += str + (values.length > ix ? values[ix++] : "");
        }
        if (res[0] === "\n")
            res = res.slice(1);
        var charIx = 0;
        while (true) {
            res = res.slice(0, charIx) + res.slice(charIx + indent);
            charIx = res.indexOf("\n", charIx) + 1;
            if (!charIx)
                break;
        }
        return res;
    };
};
exports.unpad.memo = {};
function repeat(str, length) {
    var len = length / str.length;
    var res = "";
    for (var ix = 0; ix < len; ix++)
        res += str;
    return (res.length > length) ? res.slice(0, length) : res;
}
exports.repeat = repeat;
function underline(startIx, length) {
    return repeat(" ", startIx) + "^" + repeat("~", length - 1);
}
exports.underline = underline;
function capitalize(word) {
    return word[0].toUpperCase() + word.slice(1);
}
exports.capitalize = capitalize;
function titlecase(name) {
    return name.split(" ").map(capitalize).join(" ");
}
exports.titlecase = titlecase;
exports.string = {
    unpad: exports.unpad,
    repeat: repeat,
    underline: underline,
    capitalize: capitalize,
    titlecase: titlecase
};
function tail(arr) {
    return arr[arr.length - 1];
}
exports.tail = tail;
exports.array = {
    tail: tail
};
function coerceInput(input) {
    // http://jsperf.com/regex-vs-plus-coercion
    if (!isNaN(+input))
        return +input;
    else if (input === "true")
        return true;
    else if (input === "false")
        return false;
    return input;
}
exports.coerceInput = coerceInput;
// Shallow copy the given object.
function copy(obj) {
    if (!obj || typeof obj !== "object")
        return obj;
    if (obj instanceof Array)
        return obj.slice();
    var res = {};
    for (var key in obj)
        res[key] = obj[key];
    return res;
}
exports.copy = copy;

},{"../vendor/uuid":17}],13:[function(require,module,exports){
"use strict";
var marked_1 = require("../vendor/marked");
var runtime = require("./runtime");
var queryParser_1 = require("./queryParser");
var app_1 = require("./app");
var app = require("./app");
var microReact = require("./microReact");
var utils = require("./utils");
var ui = require("./ui");
var MAX_NUMBER = runtime.MAX_NUMBER;
//---------------------------------------------------------
// Entity
//---------------------------------------------------------
exports.coerceInput = utils.coerceInput;
var breaks = /[{}\|:\n#"]/;
var types = {
    "#": "header",
    "{": "link open",
    "}": "link close",
    ":": "assignment",
    "\"": "text",
};
function tokenize(entity) {
    var line = 0;
    var ix = 0;
    var len = entity.length;
    var tokens = [];
    var cur = { ix: ix, line: line, type: "text", text: "" };
    for (; ix < len; ix++) {
        var ch = entity[ix];
        if (ch.match(breaks)) {
            var type = types[ch];
            if (type === "text") {
                ch = entity[++ix];
                while (ch && ch !== "\"") {
                    if (ch === "\n")
                        line++;
                    cur.text += ch;
                    ch = entity[++ix];
                }
                tokens.push(cur);
                ix++;
                cur = { ix: ix + 1, line: line, type: "text", text: "" };
                continue;
            }
            if (ch === "\n")
                line++;
            if (cur.text !== "" || cur.line !== line) {
                tokens.push(cur);
            }
            if (ch === "\n") {
                cur = { ix: ix + 1, line: line, type: "text", text: "" };
                continue;
            }
            cur = { ix: ix, line: line, type: type, text: ch };
            tokens.push(cur);
            if (types[cur.text]) {
                cur.type = types[cur.text];
            }
            if (type === "header") {
                //trim the next character if it's a space between the header indicator
                //and the text;
                if (entity[ix + 1] === " ")
                    ix++;
            }
            cur = { ix: ix + 1, line: line, type: "text", text: "" };
        }
        else {
            cur.text += ch;
        }
    }
    tokens.push(cur);
    return tokens;
}
function parse(tokens) {
    var links = [];
    var eavs = [];
    var collections = [];
    var state = { items: [] };
    var lines = [];
    var line;
    var lineIx = -1;
    for (var _i = 0; _i < tokens.length; _i++) {
        var token = tokens[_i];
        if (token.line !== lineIx) {
            // this accounts for blank lines.
            while (lineIx < token.line) {
                line = { ix: token.line, header: false, items: [] };
                lines.push(line);
                lineIx++;
            }
        }
        var type = token.type;
        switch (type) {
            case "header":
                line.header = true;
                break;
            case "link open":
                state.capturing = true;
                state.mode = "link";
                state.items.push(token);
                break;
            case "link close":
                state.items.push(token);
                state.type = "link";
                if (state.mode === "assignment") {
                    if (state.attribute === "is a") {
                        state.type = "collection";
                        state.link = state.value;
                    }
                    else {
                        state.type = "eav";
                    }
                    eavs.push(state);
                }
                else {
                    state.type = "eav";
                    state.attribute = "generic related to";
                    state.value = state.link;
                    eavs.push(state);
                }
                line.items.push(state);
                state = { items: [] };
                break;
            case "assignment":
                if (!state.capturing) {
                    token.type = "text";
                    line.items.push(token);
                    break;
                }
                state.mode = "assignment";
                state.attribute = state.link;
                break;
            case "text":
                if (!state.capturing) {
                    line.items.push(token);
                }
                else if (state.mode === "link") {
                    state.link = token.text.trim();
                    state.items.push(token);
                }
                else if (state.mode === "assignment") {
                    state.value = exports.coerceInput(token.text.trim());
                    state.items.push(token);
                }
                break;
        }
    }
    return { lines: lines, links: links, collections: collections, eavs: eavs };
}
var parseCache;
function parseEntity(entityId, content) {
    if (!parseCache)
        parseCache = {};
    var cached = parseCache[entityId];
    if (!cached || cached[0] !== content) {
        cached = parseCache[entityId] = [content, parse(tokenize(content))];
    }
    return cached[1];
}
function CodeMirrorElement(node, elem) {
    var cm = node.editor;
    if (!cm) {
        cm = node.editor = new CodeMirror(node, {
            mode: "gfm",
            lineWrapping: true,
            extraKeys: {
                "Cmd-Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    commitEntity(cm, latest);
                },
                "Ctrl-Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    commitEntity(cm, latest);
                }
            }
        });
        if (elem.onInput) {
            cm.on("change", elem.onInput);
        }
        if (elem.keydown) {
            cm.on("keydown", function (cm) { elem.keydown(cm, elem); });
        }
        if (elem.blur) {
            cm.on("blur", function (cm) { elem.blur(cm, elem); });
        }
        cm.focus();
    }
    if (cm.getValue() !== elem.value) {
        cm.setValue(elem.value);
    }
}
function NewBitEditor(node, elem) {
    var cm = node.editor;
    if (!cm) {
        cm = node.editor = new CodeMirror(node, {
            mode: "gfm",
            lineWrapping: true,
            extraKeys: {
                "Cmd-Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    submitAction(cm, latest);
                },
                "Ctrl-Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    submitAction(cm, latest);
                }
            }
        });
        if (elem.onInput) {
            cm.on("change", elem.onInput);
        }
        if (elem.keydown) {
            cm.on("keydown", function (cm) { elem.keydown(cm, elem); });
        }
        if (elem.blur) {
            cm.on("blur", function (cm) { elem.blur(cm, elem); });
        }
        cm.focus();
        cm.setValue("\n");
        // create a line widget
        var widget = document.createElement("div");
        widget.className = "header-line";
        cm.addLineWidget(0, widget);
        cm.addLineClass(0, "text", "header");
    }
    if (cm.getValue() !== elem.value) {
        cm.setValue(elem.value);
    }
}
function CMSearchBox(node, elem) {
    var cm = node.editor;
    if (!cm) {
        var state = { marks: [] };
        cm = node.editor = new CodeMirror(node, {
            lineWrapping: true,
            extraKeys: {
                "Enter": function (cm) {
                    var latest = app.renderer.tree[elem.id];
                    app.dispatch("setSearch", { value: cm.getValue(), searchId: latest.searchId }).commit();
                }
            }
        });
        cm.on("change", function (cm) {
            var value = cm.getValue();
            var tokens = queryParser_1.getTokens(value);
            for (var _i = 0, _a = state.marks; _i < _a.length; _i++) {
                var mark = _a[_i];
                mark.clear();
            }
            state.marks = [];
            for (var _b = 0; _b < tokens.length; _b++) {
                var token = tokens[_b];
                var start = cm.posFromIndex(token.pos);
                var stop = cm.posFromIndex(token.pos + token.orig.length);
                state.marks.push(cm.markText(start, stop, { className: queryParser_1.TokenTypes[token.type].toLowerCase() }));
            }
        });
        cm.focus();
    }
    if (cm.getValue() !== elem.value) {
        cm.setValue(elem.value);
    }
}
function entityToGraph(entityId, content) {
    var parsed = parseEntity(entityId, content);
    var links = [];
    for (var _i = 0, _a = parsed.links; _i < _a.length; _i++) {
        var link = _a[_i];
        links.push({ link: link.link.toLowerCase(), type: (link.linkType || "unknown").toLowerCase() });
    }
    for (var _b = 0, _c = parsed.collections; _b < _c.length; _b++) {
        var collection = _c[_b];
        links.push({ link: collection.link.toLowerCase(), type: "collection" });
    }
    return links;
}
//---------------------------------------------------------
// Wiki
//---------------------------------------------------------
var dragging = null;
app.handle("startEditingEntity", function (result, info) {
    result.add("editing", { editing: true, search: info.searchId });
});
app.handle("stopEditingEntity", function (result, info) {
    if (!app_1.eve.findOne("editing"))
        return;
    result.remove("editing");
    var entity = info.entity, value = info.value;
    entity = entity.trim().toLowerCase();
    if (!entity)
        return;
    var blockId = entity + "|manual content block";
    if (!app_1.eve.findOne("manual eav", { entity: blockId })) {
        result.add("manual eav", { entity: blockId, attribute: "is a", value: "content block" });
        result.add("manual eav", { entity: blockId, attribute: "source", value: "manual" });
        result.add("manual eav", { entity: blockId, attribute: "associated entity", value: entity });
    }
    else {
        result.remove("manual eav", { entity: blockId, attribute: "content" });
    }
    result.add("manual eav", { entity: blockId, attribute: "content", value: value });
});
app.handle("setSearch", function (result, info) {
    var searchId = info.searchId;
    var search = app_1.eve.findOne("search query", { id: searchId })["search"];
    if (search === info.value)
        return;
    if (!app_1.eve.findOne("history stack", { entity: search })) {
        var stack = app_1.eve.find("history stack");
        result.add("history stack", { entity: search, pos: stack.length });
    }
    var newSearchValue = info.value.trim();
    app.activeSearches[searchId] = queryParser_1.queryToExecutable(newSearchValue);
    result.remove("builtin search query", { id: searchId });
    result.add("builtin search query", { id: searchId, search: newSearchValue });
});
app.handle("submitAction", function (result, info) {
    var searchId = info.searchId;
    var search = app_1.eve.findOne("search query", { id: searchId })["search"];
    result.merge(saveSearch(search, app.activeSearches[searchId].executable));
    if (info.type === "attribute") {
        if (!info.entity || !info.attribute || !info.value)
            return;
        result.merge(addEavAction(search, info.entity, info.attribute, info.value));
    }
    else if (info.type === "collection") {
        result.merge(addToCollectionAction(search, info.entity, info.collection));
    }
    else if (info.type === "bit") {
        var template = info.template.trim();
        if (template[0] !== "#") {
            template = "# " + template;
        }
        result.merge(addBitAction(search, template));
    }
});
app.handle("addNewSearch", function (result, info) {
    var id = uuid();
    var search = info.search || "";
    app.activeSearches[id] = queryParser_1.queryToExecutable(search);
    result.add("builtin search", { id: id, top: info.top || 100, left: info.left || 100 });
    result.add("builtin search query", { id: id, search: search });
});
app.handle("addNewSyntaxSearch", function (result, info) {
    var id = uuid();
    var code = info.search || "";
    result.add("builtin syntax search", { id: id, top: info.top || 100, left: info.left || 100 });
    result.add("builtin syntax search code", { id: id, code: code });
});
app.handle("removeSearch", function (result, info) {
    var searchId = info.searchId;
    if (!searchId)
        return;
    result.remove("builtin search", { id: searchId });
    result.remove("builtin search query", { id: searchId });
    result.remove("builtin syntax search", { id: searchId });
    result.remove("builtin syntax search code", { id: searchId });
    for (var _i = 0, _a = app_1.eve.find("builtin syntax search view", { id: searchId }); _i < _a.length; _i++) {
        var view = _a[_i];
        var diff_1 = removeView(view.view);
        result.merge(diff_1);
    }
    result.remove("builtin syntax search view", { id: searchId });
    result.remove("builtin syntax search error", { id: searchId });
    app.activeSearches[searchId] = null;
});
app.handle("startAddingAction", function (result, info) {
    result.remove("adding action");
    result.add("adding action", { type: info.type, search: info.searchId });
});
app.handle("stopAddingAction", function (result, info) {
    result.remove("adding action");
});
app.handle("removeAction", function (result, info) {
    if (info.type === "eav") {
        result.merge(removeAddEavAction(info.actionId));
    }
    else if (info.type === "collection") {
        result.merge(removeAddToCollectionAction(info.actionId));
    }
    else if (info.type === "bit") {
        result.merge(removeAddBitAction(info.actionId));
    }
});
app.handle("startDragging", function (result, info) {
    var searchId = info.searchId, x = info.x, y = info.y;
    var pos = app_1.eve.findOne("search", { id: searchId });
    if (!pos) {
        pos = app_1.eve.findOne("builtin syntax search", { id: searchId });
    }
    dragging = { id: searchId, offsetTop: y - pos.top, offsetLeft: x - pos.left, action: info.action || "moveSearch" };
});
app.handle("stopDragging", function (result, info) {
    dragging = null;
});
app.handle("moveSearch", function (result, info) {
    var searchId = info.searchId, x = info.x, y = info.y;
    if (app_1.eve.findOne("builtin search", { id: searchId })) {
        result.remove("builtin search", { id: searchId });
        result.add("builtin search", { id: searchId, top: y - dragging.offsetTop, left: x - dragging.offsetLeft });
    }
    else {
        result.remove("builtin syntax search", { id: searchId });
        result.add("builtin syntax search", { id: searchId, top: y - dragging.offsetTop, left: x - dragging.offsetLeft });
    }
});
app.handle("resizeSearch", function (result, info) {
    var searchId = info.searchId, x = info.x, y = info.y;
    var type = "builtin search size";
    var pos = app_1.eve.findOne("builtin search", { id: searchId });
    if (!pos) {
        pos = app_1.eve.findOne("builtin syntax search", { id: searchId });
    }
    result.remove("builtin search size", { id: searchId });
    var height = y - pos.top + 5;
    var width = x - pos.left + 5;
    if (width <= 100) {
        width = 100;
    }
    if (height <= 100) {
        height = 100;
    }
    result.add(type, { id: searchId, width: width, height: height });
});
app.handle("toggleShowPlan", function (result, info) {
    if (app_1.eve.findOne("showPlan", { search: info.searchId })) {
        result.remove("showPlan", { search: info.searchId });
    }
    else {
        result.add("showPlan", { search: info.searchId });
    }
});
function root() {
    if (window["slides"])
        return window["slides"].root();
    else if (window["NEUE_UI"])
        return ui.root();
    else
        return eveRoot();
}
exports.root = root;
function eveRoot() {
    var searchers = [];
    for (var _i = 0, _a = app_1.eve.find("search"); _i < _a.length; _i++) {
        var search = _a[_i];
        searchers.push(newSearchResults(search.id));
    }
    for (var _b = 0, _c = app_1.eve.find("builtin syntax search"); _b < _c.length; _b++) {
        var search = _c[_b];
        searchers.push(syntaxSearch(search.id));
    }
    return { id: "root", c: "root", dblclick: addNewSearch, children: [
            //       slideControls(),
            { c: "canvas", mousemove: maybeDrag, mouseup: stopDragging, children: searchers },
        ] };
}
exports.eveRoot = eveRoot;
function maybeDrag(e, elem) {
    if (dragging) {
        app.dispatch(dragging.action, { searchId: dragging.id, x: e.clientX, y: e.clientY }).commit();
        e.preventDefault();
    }
}
function addNewSearch(e, elem) {
    if (e.target.classList.contains("canvas")) {
        if (e.shiftKey) {
            app.dispatch("addNewSyntaxSearch", { top: e.clientY, left: e.clientX }).commit();
        }
        else {
            app.dispatch("addNewSearch", { top: e.clientY, left: e.clientX }).commit();
        }
        e.preventDefault();
    }
}
function injectEmbeddedSearches(node, elem) {
    var embedded = node.querySelectorAll("[data-embedded-search]");
    for (var _i = 0; _i < embedded.length; _i++) {
        var embed = embedded[_i];
        var search = void 0, searchId = void 0, searchText = embed.getAttribute("data-embedded-search");
        for (var id in app.activeSearches) {
            if (app.activeSearches[id].text === searchText) {
                searchId = id;
                break;
            }
        }
        if (searchId)
            search = app.activeSearches[searchId];
        else {
            searchId = uuid();
            search = app.activeSearches[searchId] = queryParser_1.queryToExecutable(searchText);
        }
        // @FIXME: Horrible, horrible kludge.
        var subRenderer = new microReact.Renderer();
        var contents = entityContents(elem["searchId"], searchId, search);
        subRenderer.render(contents.elems);
        var node_1 = subRenderer.content;
        if (contents.inline) {
            embed.classList.add("inline");
            var inlineContainer = document.createElement("span");
            while (node_1.children.length) {
                inlineContainer.appendChild(node_1.firstChild);
            }
            node_1 = inlineContainer;
        }
        embed.appendChild(node_1);
    }
}
var markedEntityRenderer = new marked_1.Renderer();
markedEntityRenderer.heading = function (text, level) {
    return "<h" + level + ">" + text + "</h" + level + ">"; // override auto-setting an id based on content.
};
function entityToHTML(entityId, searchId, content, passthrough) {
    var md = marked_1.parse(content, { breaks: true, renderer: markedEntityRenderer });
    var ix = md.indexOf("{");
    var queryCount = 0;
    var stack = [];
    while (ix !== -1) {
        if (md[ix - 1] === "\\") {
            md = md.slice(0, ix - 1) + md.slice(ix);
            ix--;
        }
        else if (md[ix] === "{")
            stack.push(ix);
        else if (md[ix] === "}") {
            var startIx = stack.pop();
            var content_1 = md.slice(startIx + 1, ix);
            var colonIx = content_1.indexOf(":");
            var value = (colonIx !== -1 ? content_1.slice(colonIx + 1) : content_1).trim();
            var replacement = void 0;
            var type = "attribute";
            if (app_1.eve.findOne("collection", { collection: value.toLowerCase() }))
                type = "collection";
            else if (app_1.eve.findOne("entity", { entity: value.toLowerCase() }))
                type = "entity";
            else if (passthrough && passthrough.indexOf(value) !== -1)
                type = "passthrough";
            else if (colonIx === -1)
                type = "query";
            if (type === "attribute") {
                var attr = content_1.slice(0, colonIx).trim();
                replacement = "<span class=\"attribute\" data-attribute=\"" + attr + "\">" + value + "</span>";
            }
            else if (type === "entity") {
                var attr = content_1.slice(0, colonIx !== -1 ? colonIx : undefined).trim();
                var onClick = "app.dispatch('setSearch', {value: '" + value + "', searchId: '" + searchId + "'}).commit();";
                replacement = "<a class=\"link attribute entity\" data-attribute=\"" + attr + "\" onclick=\"" + onClick + "\">" + value + "</a>";
            }
            else if (type === "collection") {
                var attr = content_1.slice(0, colonIx !== -1 ? colonIx : undefined).trim();
                var onClick = "app.dispatch('setSearch', {value: '" + value + "', searchId: '" + searchId + "'}).commit();";
                replacement = "<a class=\"link attribute collection\" data-attribute=\"" + attr + "\" onclick=\"" + onClick + "\">" + value + "</a>";
            }
            else if (type === "query") {
                //throw new Error("@TODO: Implement embedded projections");
                // add postRender to newSearch pane container that checks for data-search attribute. If it exists, compile the search template for each of them and insert.
                var containerId = searchId + "|" + content_1 + "|" + queryCount++;
                replacement = "<span class=\"embedded-query search-results\" id=\"" + containerId + "\" data-embedded-search=\"" + content_1 + "\"></span>";
            }
            if (type !== "passthrough") {
                md = md.slice(0, startIx) + replacement + md.slice(ix + 1);
                ix += replacement.length - content_1.length - 2;
            }
        }
        else {
            throw new Error("Unexpected character '" + md[ix] + "' at index " + ix);
        }
        // @NOTE: There has got to be a more elegant solution for (min if > 0) here.
        var nextCloseIx = md.indexOf("}", ix + 1);
        var nextOpenIx = md.indexOf("{", ix + 1);
        if (nextCloseIx === -1)
            ix = nextOpenIx;
        else if (nextOpenIx === -1)
            ix = nextCloseIx;
        else if (nextCloseIx < nextOpenIx)
            ix = nextCloseIx;
        else
            ix = nextOpenIx;
    }
    return md;
}
function entityUi(entityId, instance, searchId) {
    if (instance === void 0) { instance = ""; }
    var entityBlocks = app_1.eve.find("content blocks", { entity: entityId });
    var entityViews = [];
    for (var _i = 0; _i < entityBlocks.length; _i++) {
        var block = entityBlocks[_i];
        var isManual = app_1.eve.findOne("entity eavs", { entity: block.block, attribute: "source", value: "manual" });
        var entityView = void 0;
        if (isManual) {
            if (!app_1.eve.findOne("editing", { search: searchId })) {
                entityView = {
                    id: "" + block.block + instance,
                    c: "entity",
                    searchId: searchId,
                    entity: entityId,
                    dangerouslySetInnerHTML: entityToHTML(entityId, searchId, block.content),
                    postRender: injectEmbeddedSearches,
                    dblclick: editEntity
                };
            }
            else {
                entityView = { id: "" + block.block + instance + "|editor", c: "entity editor", entity: entityId, searchId: searchId, postRender: CodeMirrorElement, value: block.content, blur: commitEntity };
            }
            entityViews.unshift(entityView);
        }
        else {
            var source = app_1.eve.findOne("entity eavs", { entity: block.block, attribute: "source" }).value;
            //strip the header
            var content = block.content;
            content = content.substring(content.indexOf("\n"));
            var children = [{ dangerouslySetInnerHTML: entityToHTML(entityId, searchId, content) }];
            children.push({ c: "source-link ion-help", text: "", click: followLink, linkText: source, searchId: searchId });
            entityView = { id: "" + block.block + instance, c: "entity generated", searchId: searchId, entity: entityId, children: children };
            entityViews.push(entityView);
        }
    }
    if (entityViews.length === 0) {
        if (!app_1.eve.findOne("editing", { search: searchId })) {
            entityViews.push({ id: "" + entityId + instance, c: "entity", searchId: searchId, entity: entityId, children: [{ c: "placeholder", text: "Add a description" }], dblclick: editEntity });
        }
        else {
            entityViews.push({ id: "" + entityId + instance + "|editor", c: "entity editor", entity: entityId, searchId: searchId, postRender: CodeMirrorElement, value: "", blur: commitEntity });
        }
    }
    var relatedBits = [];
    for (var _a = 0, _b = app_1.eve.find("entity links", { link: entityId }); _a < _b.length; _a++) {
        var incoming = _b[_a];
        if (incoming.entity === entityId)
            continue;
        if (app_1.eve.findOne("entity eavs", { entity: incoming.entity, attribute: "is a", value: "content block" }))
            continue;
        if (app_1.eve.findOne("entity eavs", { entity: incoming.entity, attribute: "is a", value: entityId }))
            continue;
        relatedBits.push({ c: "entity link", click: followLink, searchId: searchId, linkText: incoming.entity, text: incoming.entity });
    }
    if (relatedBits.length) {
        entityViews.push({ c: "entity related-bits", children: [
                { text: "Related cards: " },
                { c: "related-list", children: relatedBits }
            ] });
    }
    return { c: "entity-container", children: [
            { c: "entity-blocks", children: entityViews },
        ] };
}
function searchDescription(tokens, plan) {
    var planChildren = [];
    for (var _i = 0; _i < plan.length; _i++) {
        var step = plan[_i];
        if (step.type === queryParser_1.StepType.GATHER) {
            var related = step.relatedTo ? "related to those" : "";
            var coll = "anything";
            if (step.subject) {
                coll = pluralize(step.subject, 2);
            }
            planChildren.push({ c: "text collection", text: "gather " + coll + " " + related });
        }
        else if (step.type === queryParser_1.StepType.INTERSECT) {
            if (step.deselected) {
                planChildren.push({ c: "text", text: "remove the " + pluralize(step.subject, 2) });
            }
            else {
                planChildren.push({ c: "text", text: "keep only the " + pluralize(step.subject, 2) });
            }
        }
        else if (step.type === queryParser_1.StepType.LOOKUP) {
            planChildren.push({ c: "text attribute", text: "lookup " + step.subject });
        }
        else if (step.type === queryParser_1.StepType.FIND) {
            planChildren.push({ c: "text entity", text: "find " + step.subject });
        }
        else if (step.type === queryParser_1.StepType.FILTERBYENTITY) {
            if (step.deselected) {
                planChildren.push({ c: "text entity", text: "remove anything related to " + step.subject });
            }
            else {
                planChildren.push({ c: "text entity", text: "related to " + step.subject });
            }
        }
        else if (step.type === queryParser_1.StepType.FILTER) {
            planChildren.push({ c: "text operation", text: "filter those by " + step.subject });
        }
        else if (step.type === queryParser_1.StepType.SORT) {
            planChildren.push({ c: "text operation", text: "sort them" });
        }
        else if (step.type === queryParser_1.StepType.GROUP) {
            planChildren.push({ c: "text operation", text: "group them" });
        }
        else if (step.type === queryParser_1.StepType.LIMIT) {
            var limit = void 0;
            if (step.limit.results) {
                limit = "to " + step.limit.results + " results";
            }
            else {
                limit = "to " + step.limit.perGroup + " items per group";
            }
            planChildren.push({ c: "text operation", text: "limit " + limit });
        }
        else if (step.type === queryParser_1.StepType.CALCULATE) {
            planChildren.push({ c: "text operation", text: "calculate " + step.func });
        }
        else if (step.type === queryParser_1.StepType.AGGREGATE) {
            planChildren.push({ c: "text operation", text: "" + step.subject });
        }
        else {
            planChildren.push({ c: "text", text: step.type + "->" });
        }
    }
    planChildren.unshift();
    return { c: "plan-container", children: [
            { c: "description", text: "Search plan:" },
            { c: "search-plan", children: planChildren }
        ] };
}
function entityContents(paneId, searchId, search) {
    var plan = search.plan;
    if (!plan.length)
        return { inline: true, elems: [{ t: "span", c: "link", text: search.queryString, linkText: search.queryString, click: followLink, searchId: paneId }] };
    var contents = [];
    var singleton = true;
    if (plan.length === 1 && (plan[0].type === queryParser_1.StepType.FIND || plan[0].type === queryParser_1.StepType.GATHER)) {
        contents.push({ c: "singleton", children: [entityUi(plan[0].subject || plan[0].subject, searchId, searchId)] });
    }
    else
        singleton = false;
    // If we're just looking up an attribute for a specific entity, embed that value
    if (plan.length === 2 && plan[0].type === queryParser_1.StepType.FIND && plan[1].type === queryParser_1.StepType.LOOKUP) {
        var results_1 = search.executable.exec();
        var text;
        if (!results_1.results.length) {
            text = "('" + search.queryString + "' was not found)";
        }
        else {
            text = results_1.results[0][plan[1].name];
        }
        return { inline: true, elems: [{ t: "span", c: "attribute", text: text }] };
    }
    if (singleton)
        return { elems: contents };
    var resultItems = [];
    contents.push({ c: "results", id: "root", children: resultItems });
    var headers = [];
    // figure out what the headers are
    for (var _i = 0; _i < plan.length; _i++) {
        var step = plan[_i];
        if (step.type === queryParser_1.StepType.FILTERBYENTITY || step.type === queryParser_1.StepType.INTERSECT)
            continue;
        if (step.size === 0)
            continue;
        headers.push({ text: step.name });
    }
    var groupedFields = {};
    // figure out what fields are grouped, if any
    for (var _a = 0; _a < plan.length; _a++) {
        var step = plan[_a];
        if (step.type === queryParser_1.StepType.GROUP) {
            groupedFields[step.subjectNode.name] = true;
        }
        else if (step.type === queryParser_1.StepType.AGGREGATE) {
            groupedFields[step.name] = true;
        }
    }
    var results = search.executable.exec();
    var groupInfo = results.groupInfo;
    var planLength = plan.length;
    var itemClass = planLength > 1 ? " bit" : " link list-item";
    row: for (var ix = 0, len = results.unprojected.length; ix < len; ix += search.executable.unprojectedSize) {
        if (groupInfo && ix > groupInfo.length)
            break;
        if (groupInfo && groupInfo[ix] === undefined)
            continue;
        // Get content row to insert into
        var resultItem = void 0;
        if (groupInfo && resultItems[groupInfo[ix]])
            resultItem = resultItems[groupInfo[ix]];
        else if (groupInfo)
            resultItem = resultItems[groupInfo[ix]] = { c: "path", children: [] };
        else {
            resultItem = { c: "path", children: [] };
            resultItems.push(resultItem);
        }
        var planOffset = 0;
        for (var planIx = 0; planIx < planLength; planIx++) {
            var planItem = plan[planIx];
            var item = void 0, id = searchId + " " + ix + " " + planIx;
            if (planItem.size) {
                var resultPart = results.unprojected[ix + planOffset + planItem.size - 1];
                if (!resultPart)
                    continue row;
                var text, klass, click, link;
                if (planItem.type === queryParser_1.StepType.GATHER) {
                    item = { id: id, c: itemClass + " entity bit", text: resultPart["entity"], click: followLink, searchId: paneId, linkText: resultPart["entity"] };
                }
                else if (planItem.type === queryParser_1.StepType.LOOKUP) {
                    item = { id: id, c: itemClass + " attribute", text: resultPart["value"] };
                }
                else if (planItem.type === queryParser_1.StepType.AGGREGATE) {
                    item = { id: id, c: itemClass + " value", text: resultPart[planItem.name] };
                }
                else if (planItem.type === queryParser_1.StepType.FILTERBYENTITY || planItem.type === queryParser_1.StepType.INTERSECT) {
                }
                else if (planItem.type === queryParser_1.StepType.CALCULATE) {
                    item = { id: id, c: itemClass + " value", text: resultPart["result"] };
                }
                else {
                    item = { id: id, c: itemClass, text: JSON.stringify(resultPart) };
                }
                if (item) {
                    if (groupedFields[planItem.name] && !resultItem.children[planIx]) {
                        resultItem.children[planIx] = { c: "sub-group", children: [item] };
                    }
                    else if (!groupedFields[planItem.name] && !resultItem.children[planIx]) {
                        resultItem.children[planIx] = { c: "sub-group", children: [item] };
                    }
                    else if (!groupedFields[planItem.name]) {
                        resultItem.children[planIx].children.push(item);
                    }
                    if (planLength === 1)
                        resultItem.c = "path list-row";
                }
                planOffset += planItem.size;
            }
        }
    }
    resultItems.unshift({ c: "search-headers", children: headers });
    return { elems: contents };
}
exports.entityContents = entityContents;
function newSearchResults(searchId) {
    var _a = app_1.eve.findOne("search", { id: searchId }), top = _a.top, left = _a.left;
    var search = app_1.eve.findOne("search query", { id: searchId })["search"];
    var _b = app.activeSearches[searchId], tokens = _b.tokens, plan = _b.plan, executable = _b.executable;
    var resultItems = [];
    var groupedFields = {};
    if (executable && plan.length && (plan.length > 1 || plan[0].type === queryParser_1.StepType.GATHER)) {
        // figure out what fields are grouped, if any
        for (var _i = 0; _i < plan.length; _i++) {
            var step = plan[_i];
            if (step.type === queryParser_1.StepType.GROUP) {
                groupedFields[step.subjectNode.name] = true;
            }
            else if (step.type === queryParser_1.StepType.AGGREGATE) {
                groupedFields[step.name] = true;
            }
        }
        var results = executable.exec();
        var groupInfo = results.groupInfo;
        var planLength = plan.length;
        row: for (var ix = 0, len = results.unprojected.length; ix < len; ix += executable.unprojectedSize) {
            if (groupInfo && ix > groupInfo.length)
                break;
            if (groupInfo && groupInfo[ix] === undefined)
                continue;
            var resultItem = void 0;
            if (groupInfo && !resultItems[groupInfo[ix]]) {
                resultItem = resultItems[groupInfo[ix]] = { c: "path", children: [] };
            }
            else if (!groupInfo) {
                resultItem = { c: "path", children: [] };
                resultItems.push(resultItem);
            }
            else {
                resultItem = resultItems[groupInfo[ix]];
            }
            var planOffset = 0;
            for (var planIx = 0; planIx < planLength; planIx++) {
                var planItem = plan[planIx];
                if (planItem.size) {
                    var resultPart = results.unprojected[ix + planOffset + planItem.size - 1];
                    if (!resultPart)
                        continue row;
                    var text = void 0, klass = void 0, click = void 0, link = void 0;
                    if (planItem.type === queryParser_1.StepType.GATHER) {
                        text = resultPart["entity"];
                        klass = "entity";
                        click = followLink;
                        link = resultPart["entity"];
                    }
                    else if (planItem.type === queryParser_1.StepType.LOOKUP) {
                        text = resultPart["value"];
                        klass = "attribute";
                    }
                    else if (planItem.type === queryParser_1.StepType.AGGREGATE) {
                        text = resultPart[planItem.subject];
                        klass = "value";
                    }
                    else if (planItem.type === queryParser_1.StepType.FILTERBYENTITY || planItem.type === queryParser_1.StepType.INTERSECT) {
                    }
                    else if (planItem.type === queryParser_1.StepType.CALCULATE) {
                        text = JSON.stringify(resultPart.result);
                        klass = "value";
                    }
                    else {
                        text = JSON.stringify(resultPart);
                    }
                    if (text !== undefined) {
                        klass += planLength > 1 ? " bit" : " link list-item";
                        var item = { id: searchId + " " + ix + " " + planIx, c: "" + klass, text: text, click: click, searchId: searchId, linkText: link };
                        if (groupedFields[planItem.name] && !resultItem.children[planIx]) {
                            resultItem.children[planIx] = { c: "sub-group", children: [item] };
                        }
                        else if (!groupedFields[planItem.name] && !resultItem.children[planIx]) {
                            resultItem.children[planIx] = { c: "sub-group", children: [item] };
                        }
                        else if (!groupedFields[planItem.name]) {
                            resultItem.children[planIx].children.push(item);
                        }
                        if (planLength === 1) {
                            resultItem.c = "path list-row";
                        }
                    }
                    planOffset += planItem.size;
                }
            }
        }
    }
    var entityContent = [];
    var noHeaders = false;
    if (plan.length === 1 && plan[0].type === queryParser_1.StepType.FIND) {
        entityContent.push({ c: "singleton", children: [entityUi(plan[0].subject, searchId, searchId)] });
    }
    else if (plan.length === 1 && plan[0].type === queryParser_1.StepType.GATHER) {
        entityContent.unshift({ c: "singleton", children: [entityUi(plan[0].subject, searchId, searchId)] });
        var text = "There are no " + pluralize(plan[0].subject, resultItems.length) + " in the system.";
        if (resultItems.length > 0) {
            text = "There " + pluralize("are", resultItems.length) + " " + resultItems.length + " " + pluralize(plan[0].subject, resultItems.length) + ":";
        }
        resultItems.unshift({ c: "description", text: text });
        noHeaders = true;
    }
    else if (plan.length === 0) {
        entityContent.push({ c: "singleton", children: [entityUi(search.toLowerCase(), searchId, searchId)] });
    }
    else {
        var headers = [];
        // figure out what the headers are
        if (!noHeaders) {
            for (var _c = 0; _c < plan.length; _c++) {
                var step = plan[_c];
                if (step.type === queryParser_1.StepType.FILTERBYENTITY || step.type === queryParser_1.StepType.INTERSECT)
                    continue;
                if (step.size === 0)
                    continue;
                headers.push({ text: step.name });
            }
        }
        resultItems.unshift({ c: "search-headers", children: headers });
    }
    var actions = [];
    for (var _d = 0, _e = app_1.eve.find("add bit action", { view: search }); _d < _e.length; _d++) {
        var bitAction = _e[_d];
        var template = bitAction.template, action = bitAction.action;
        actions.push({ c: "action new-bit", children: [
                { c: "bit entity", dangerouslySetInnerHTML: entityToHTML(action, searchId, template, Object.keys(executable.projectionMap)) },
                { c: "remove ion-android-close", click: removeAction, actionType: "bit", actionId: bitAction.action }
            ] });
    }
    var actionContainer;
    var addActionChildren = [];
    var adding = app_1.eve.findOne("adding action", { search: searchId });
    if (adding) {
        if (adding.type === "bit") {
            addActionChildren.push({ c: "add-card-editor", children: [
                    { c: "new-bit-editor", searchId: searchId, value: "\n", postRender: NewBitEditor },
                    { c: "spacer" },
                    //         {c: "button", text: "submit", click: submitAction},
                    { c: "ion-android-close close", click: stopAddingAction },
                ] });
        }
    }
    if (plan.length && plan[0].type !== queryParser_1.StepType.FIND) {
        var text = "Add a card";
        if (actions.length) {
            text = "Add another card";
        }
        actionContainer = { c: "actions-container", children: [
                { c: "actions-header", children: [
                        { c: "add-card-link", text: text, actionType: "bit", searchId: searchId, click: startAddingAction },
                    ] },
                actions.length ? { c: "actions", children: actions } : undefined,
            ] };
    }
    var size = app_1.eve.findOne("builtin search size", { id: searchId });
    var width, height;
    if (size) {
        width = size.width;
        height = size.height;
    }
    var isDragging = dragging && dragging.id === searchId ? "dragging" : "";
    var showPlan = app_1.eve.findOne("showPlan", { search: searchId }) ? searchDescription(tokens, plan) : undefined;
    return { id: searchId + "|container", c: "container search-container " + isDragging, top: top, left: left, width: width, height: height, children: [
            { c: "search-input", mousedown: startDragging, mouseup: stopDragging, searchId: searchId, children: [
                    { c: "search-box", value: search, postRender: CMSearchBox, searchId: searchId },
                    { c: "spacer" },
                    { c: "ion-ios-arrow-" + (showPlan ? 'up' : 'down') + " plan", click: toggleShowPlan, searchId: searchId },
                    { c: "ion-android-close close", click: removeSearch, searchId: searchId },
                ] },
            { c: "container-content", children: [
                    showPlan,
                    { c: "entity-content", children: entityContent },
                    resultItems.length ? { c: "search-results", children: resultItems } : {},
                    actionContainer,
                    { c: "add-action", children: addActionChildren },
                ] },
            { c: "resize", mousedown: startDragging, mouseup: stopDragging, searchId: searchId, action: "resizeSearch" }
        ] };
}
exports.newSearchResults = newSearchResults;
function removeAction(e, elem) {
    app.dispatch("removeAction", { type: elem.actionType, actionId: elem.actionId }).commit();
}
function toggleShowPlan(e, elem) {
    app.dispatch("toggleShowPlan", { searchId: elem.searchId }).commit();
}
function startDragging(e, elem) {
    if (e.target === e.currentTarget) {
        app.dispatch("startDragging", { searchId: elem.searchId, x: e.clientX, y: e.clientY, action: elem.action }).commit();
    }
}
function stopDragging(e, elem) {
    if (!dragging)
        return;
    app.dispatch("stopDragging", {}).commit();
}
function removeSearch(e, elem) {
    app.dispatch("removeSearch", { searchId: elem.searchId }).commit();
}
function startAddingAction(e, elem) {
    app.dispatch("startAddingAction", { type: elem.actionType, searchId: elem.searchId }).commit();
}
function stopAddingAction(e, elem) {
    app.dispatch("stopAddingAction", {}).commit();
}
function submitAction(e, elem) {
    var values = { type: app_1.eve.findOne("adding action")["type"],
        searchId: elem.searchId };
    if (values.type === "bit") {
        if (e.getValue) {
            values.template = e.getValue();
        }
        else {
            var editor = e.currentTarget.parentNode.querySelector("new-bit-editor").editor;
            values.template = editor.getValue();
        }
    }
    else {
        var parent_1 = e.currentTarget.parentNode;
        for (var _i = 0, _a = parent_1.childNodes; _i < _a.length; _i++) {
            var child = _a[_i];
            if (child.nodeName === "INPUT") {
                values[child.className] = child.value;
            }
        }
    }
    app.dispatch("submitAction", values)
        .dispatch("stopAddingAction", {})
        .commit();
}
function commitEntity(cm, elem) {
    app.dispatch("stopEditingEntity", { searchId: elem.searchId, entity: elem.entity, value: cm.getValue() }).commit();
}
function editEntity(e, elem) {
    app.dispatch("startEditingEntity", { searchId: elem.searchId, entity: elem.entity }).commit();
    e.preventDefault();
}
function followLink(e, elem) {
    app.dispatch("setSearch", { value: elem.linkText, searchId: elem.searchId }).commit();
}
function saveSearch(name, query) {
    if (!app_1.eve.findOne("view", { view: name })) {
        query.name = name;
        var diff_2 = queryObjectToDiff(query);
        return diff_2;
    }
    else {
        return app_1.eve.diff();
    }
}
function addToCollectionAction(name, field, collection) {
    var diff = app_1.eve.diff();
    // add an action
    var action = name + "|" + field + "|" + collection;
    diff.add("add collection action", { view: name, action: action, field: field, collection: collection });
    diff.add("action", { view: "added collections", action: action, kind: "union", ix: 1 });
    // a source
    diff.add("action source", { action: action, "source view": name });
    // a mapping
    diff.add("action mapping", { action: action, from: "entity", "to source": action, "to field": field });
    diff.add("action mapping constant", { action: action, from: "collection", value: collection });
    diff.add("action mapping constant", { action: action, from: "source view", value: name });
    return diff;
}
function removeAddToCollectionAction(action) {
    var info = app_1.eve.findOne("add collection action", { action: action });
    if (info) {
        var diff_3 = addToCollectionAction(info.view, info.field, info.collection);
        return diff_3.reverse();
    }
    else {
        return app_1.eve.diff();
    }
}
function addEavAction(name, entity, attribute, field) {
    var diff = app_1.eve.diff();
    // add an action
    var action = name + "|" + entity + "|" + attribute + "|" + field;
    diff.add("add eav action", { view: name, action: action, entity: entity, attribute: attribute, field: field, });
    diff.add("action", { view: "added eavs", action: action, kind: "union", ix: 1 });
    // a source
    diff.add("action source", { action: action, "source view": name });
    // a mapping
    diff.add("action mapping", { action: action, from: "entity", "to source": action, "to field": entity });
    diff.add("action mapping", { action: action, from: "value", "to source": action, "to field": field });
    diff.add("action mapping constant", { action: action, from: "attribute", value: attribute });
    diff.add("action mapping constant", { action: action, from: "source view", value: name });
    return diff;
}
exports.addEavAction = addEavAction;
function removeAddEavAction(action) {
    var info = app_1.eve.findOne("add eav action", { action: action });
    if (info) {
        var diff_4 = addEavAction(info.view, info.entity, info.attribute, info.field);
        return diff_4.reverse();
    }
    else {
        return app_1.eve.diff();
    }
}
function addBitAction(name, template) {
    // console.log(name, "|", template, "|", query);
    var diff = app_1.eve.diff();
    // add an action
    var bitQueryId = name + "|bit";
    var action = name + "|" + template;
    diff.add("add bit action", { view: name, action: action, template: template });
    //   diff.remove("add bit action", {view: name});
    var bitQuery = app_1.eve.query(bitQueryId)
        .select("add bit action", { view: name }, "action")
        .select(name, {}, "table")
        .calculate("bit template", { row: ["table"], name: name, template: ["action", "template"], action: ["action", "action"] }, "result")
        .project({ entity: ["result", "entity"], attribute: ["result", "attribute"], value: ["result", "value"] });
    diff.merge(queryObjectToDiff(bitQuery));
    // diff.merge(removeView(bitQueryId));
    diff.add("action", { view: "generated eav", action: action, kind: "union", ix: 1 });
    // a source
    diff.add("action source", { action: action, "source view": bitQueryId });
    // a mapping
    diff.add("action mapping", { action: action, from: "entity", "to source": action, "to field": "entity" });
    diff.add("action mapping", { action: action, from: "attribute", "to source": action, "to field": "attribute" });
    diff.add("action mapping", { action: action, from: "value", "to source": action, "to field": "value" });
    diff.add("action mapping constant", { action: action, from: "source view", value: name });
    return diff;
}
exports.addBitAction = addBitAction;
function removeAddBitAction(action) {
    var info = app_1.eve.findOne("add bit action", { action: action });
    if (info) {
        var diff_5 = addBitAction(info.view, info.template);
        return diff_5.reverse();
    }
    else {
        return app_1.eve.diff();
    }
}
function removeView(view) {
    return runtime.Query.remove(view, app_1.eve);
}
exports.removeView = removeView;
function clearSaved() {
    var diff = app_1.eve.diff();
    diff.remove("view");
    diff.remove("action");
    diff.remove("action source");
    diff.remove("action mapping");
    diff.remove("action mapping constant");
    diff.remove("action mapping sorted");
    diff.remove("action mapping limit");
    diff.remove("add collection action");
    diff.remove("add eav action");
    return diff;
}
exports.clearSaved = clearSaved;
//---------------------------------------------------------
// Syntax search
//---------------------------------------------------------
app.handle("setSyntaxSearch", function (result, info) {
    var searchId = info.searchId;
    var code = app_1.eve.findOne("builtin syntax search code", { id: searchId })["code"];
    if (code === info.code)
        return;
    var newSearchValue = info.code.trim();
    var wrapped = newSearchValue;
    if (wrapped.indexOf("(query") !== 0) {
        wrapped = "(query :$$view \"" + searchId + "\"\n" + wrapped + ")";
    }
    // remove the old one
    for (var _i = 0, _a = app_1.eve.find("builtin syntax search view", { id: searchId }); _i < _a.length; _i++) {
        var view = _a[_i];
        var diff_6 = removeView(view.view);
        result.merge(diff_6);
    }
    result.remove("builtin syntax search view", { id: searchId });
    result.remove("builtin syntax search error", { id: searchId });
    try {
        var parsed = window["parser"].parseDSL(wrapped);
        for (var view in parsed.views) {
            result.add("builtin syntax search view", { id: searchId, view: view });
        }
        result.merge(window["parser"].asDiff(app_1.eve, parsed));
    }
    catch (e) {
        result.add("builtin syntax search error", { id: searchId, error: e.toString() });
    }
    result.remove("builtin syntax search code", { id: searchId });
    result.add("builtin syntax search code", { id: searchId, code: newSearchValue });
});
function CMSyntaxEditor(node, elem) {
    var cm = node.editor;
    if (!cm) {
        var state = { marks: [] };
        cm = node.editor = new CodeMirror(node, {
            mode: "clojure",
            lineWrapping: true,
            extraKeys: {
                "Ctrl-Enter": function (cm) {
                    app.dispatch("setSyntaxSearch", { searchId: elem.searchId, code: cm.getValue() }).commit();
                },
                "Cmd-Enter": function (cm) {
                    app.dispatch("setSyntaxSearch", { searchId: elem.searchId, code: cm.getValue() }).commit();
                }
            }
        });
        cm.on("change", function (cm) {
            //       let value = cm.getValue();
            //       let tokens = newSearchTokens(value);
            //       for(let mark of state.marks) {
            //         mark.clear();
            //       }
            //       state.marks = [];
            //       for(let token of tokens) {
            //         let start = cm.posFromIndex(token.pos);
            //         let stop = cm.posFromIndex(token.pos + token.orig.length);
            //         state.marks.push(cm.markText(start, stop, {className: token.type}));
            //       }
        });
        cm.focus();
    }
    if (cm.getValue() !== elem.value) {
        cm.setValue(elem.value);
    }
}
function syntaxSearch(searchId) {
    var _a = app_1.eve.findOne("builtin syntax search", { id: searchId }), top = _a.top, left = _a.left;
    var code = app_1.eve.findOne("builtin syntax search code", { id: searchId })["code"];
    var isDragging = dragging && dragging.id === searchId ? "dragging" : "";
    var error = app_1.eve.findOne("builtin syntax search error", { id: searchId });
    var resultUi;
    if (!error) {
        var results = app_1.eve.find(searchId);
        var fields = Object.keys(results[0] || {}).filter(function (field) { return field !== "__id"; });
        var headers = [];
        for (var _i = 0; _i < fields.length; _i++) {
            var field = fields[_i];
            headers.push({ c: "header", text: field });
        }
        var resultItems = [];
        for (var _b = 0; _b < results.length; _b++) {
            var result = results[_b];
            var fieldItems = [];
            for (var _c = 0; _c < fields.length; _c++) {
                var field = fields[_c];
                fieldItems.push({ c: "field", text: result[field] });
            }
            resultItems.push({ c: "row", children: fieldItems });
        }
        resultUi = { c: "results", children: [
                { c: "headers", children: headers },
                { c: "rows", children: resultItems }
            ] };
    }
    else {
        resultUi = { c: "error", text: error.error };
    }
    var size = app_1.eve.findOne("builtin search size", { id: searchId });
    var width, height;
    if (size) {
        width = size.width;
        height = size.height;
    }
    return { id: searchId + "|container", c: "container search-container " + isDragging + " syntax-search", top: top, left: left, width: width, height: height, children: [
            { c: "search-input", mousedown: startDragging, searchId: searchId, children: [
                    { c: "search-box syntax-editor", value: code, postRender: CMSyntaxEditor, searchId: searchId },
                    { c: "ion-android-close close", click: removeSearch, searchId: searchId },
                ] },
            resultUi,
            { c: "resize", mousedown: startDragging, searchId: searchId, action: "resizeSearch" }
        ] };
}
//---------------------------------------------------------
// AST and compiler
//---------------------------------------------------------
// view: view, kind[union|query|table]
// action: view, action, kind[select|calculate|project|union|ununion|stateful|limit|sort|group|aggregate], ix
// action source: action, source view
// action mapping: action, from, to source, to field
// action mapping constant: action, from, value
var recompileTrigger = {
    exec: function () {
        for (var _i = 0, _a = app_1.eve.find("view"); _i < _a.length; _i++) {
            var view = _a[_i];
            if (view.kind === "table")
                continue;
            var query = compile(app_1.eve, view.view);
            app_1.eve.asView(query);
        }
        return {};
    }
};
app_1.eve.addTable("view", ["view", "kind"]);
app_1.eve.addTable("action", ["view", "action", "kind", "ix"]);
app_1.eve.addTable("action source", ["action", "source view"]);
app_1.eve.addTable("action mapping", ["action", "from", "to source", "to field"]);
app_1.eve.addTable("action mapping constant", ["action", "from", "value"]);
app_1.eve.addTable("action mapping sorted", ["action", "ix", "source", "field", "direction"]);
app_1.eve.addTable("action mapping limit", ["action", "limit type", "value"]);
app_1.eve.table("view").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action source").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action mapping").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action mapping constant").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action mapping sorted").triggers["recompile"] = recompileTrigger;
app_1.eve.table("action mapping limit").triggers["recompile"] = recompileTrigger;
function queryObjectToDiff(query) {
    return query.changeset(app_1.eve);
}
// add the added collections union so that sources can be added to it by
// actions.
var diff = app_1.eve.diff();
diff.add("view", { view: "generated eav", kind: "union" });
app_1.eve.applyDiff(diff);
function compile(ixer, viewId) {
    var view = ixer.findOne("view", { view: viewId });
    if (!view) {
        throw new Error("No view found for " + viewId + ".");
    }
    var compiled = ixer[view.kind](viewId);
    var actions = ixer.find("action", { view: viewId });
    if (!actions) {
        throw new Error("View " + viewId + " has no actions.");
    }
    // sort actions by ix
    actions.sort(function (a, b) { return a.ix - b.ix; });
    for (var _i = 0; _i < actions.length; _i++) {
        var action = actions[_i];
        var actionKind = action.kind;
        if (actionKind === "limit") {
            var limit = {};
            for (var _a = 0, _b = ixer.find("action mapping limit", { action: action.action }); _a < _b.length; _a++) {
                var limitMapping = _b[_a];
                limit[limitMapping["limit type"]] = limitMapping["value"];
            }
            compiled.limit(limit);
        }
        else if (actionKind === "sort" || actionKind === "group") {
            var sorted = [];
            var mappings = ixer.find("action mapping sorted", { action: action.action });
            mappings.sort(function (a, b) { return a.ix - b.ix; });
            for (var _c = 0; _c < mappings.length; _c++) {
                var mapping = mappings[_c];
                sorted.push([mapping["source"], mapping["field"], mapping["direction"]]);
            }
            if (sorted.length) {
                compiled[actionKind](sorted);
            }
            else {
                throw new Error(actionKind + " without any mappings: " + action.action);
            }
        }
        else {
            var mappings = ixer.find("action mapping", { action: action.action });
            var mappingObject = {};
            for (var _d = 0; _d < mappings.length; _d++) {
                var mapping = mappings[_d];
                var source_1 = mapping["to source"];
                var field = mapping["to field"];
                if (actionKind === "union" || actionKind === "ununion") {
                    mappingObject[mapping.from] = [field];
                }
                else {
                    mappingObject[mapping.from] = [source_1, field];
                }
            }
            var constants = ixer.find("action mapping constant", { action: action.action });
            for (var _e = 0; _e < constants.length; _e++) {
                var constant = constants[_e];
                mappingObject[constant.from] = constant.value;
            }
            var source = ixer.findOne("action source", { action: action.action });
            if (!source && actionKind !== "project") {
                throw new Error(actionKind + " action without a source in '" + viewId + "'");
            }
            if (actionKind !== "project") {
                compiled[actionKind](source["source view"], mappingObject, action.action);
            }
            else {
                compiled[actionKind](mappingObject);
            }
        }
    }
    return compiled;
}
exports.compile = compile;
//---------------------------------------------------------
// Eve functions
//---------------------------------------------------------
runtime.define("entity to graph", { multi: true }, function (entity, text) {
    return entityToGraph(entity, text);
});
runtime.define("parse eavs", { multi: true }, function (entity, text) {
    return parseEntity(entity, text).eavs;
});
runtime.define("bit template", { multi: true }, function (row, name, template, action) {
    var content = template;
    for (var key in row) {
        var item = row[key];
        content = content.replace(new RegExp("{" + key.replace(/([.*+?^=!:${}()|\[\]\/\\])/g, "\\$1") + "}", "gi"), item);
    }
    var entity;
    var header = content.match(/#.*$/mgi);
    if (header) {
        entity = header[0].replace("#", "").toLowerCase().trim();
    }
    else {
        entity = name + "|" + row.__id;
    }
    var blockId = action + "|" + row.__id;
    return [{ entity: blockId, attribute: "is a", value: "content block" },
        { entity: blockId, attribute: "associated entity", value: entity },
        { entity: blockId, attribute: "content", value: content },
        { entity: blockId, attribute: "source", value: name }];
});
runtime.define("collection content", {}, function (collection) {
    return { content: "# " + pluralize(collection, 2) };
});
//---------------------------------------------------------
// Queries
//---------------------------------------------------------
// eve.addTable("manual entity", ["entity", "content"]);
// eve.addTable("action entity", ["entity", "content", "source"]);
// eve.asView(eve.union("entity")
//               .union("manual entity", {entity: ["entity"], content: ["content"]})
//               .union("action entity", {entity: ["entity"], content: ["content"]})
//               .union("unmodified added bits", {entity: ["entity"], content: ["content"]})
//               .union("automatic collection entities", {entity: ["entity"], content: ["content"]}));
// eve.asView(eve.query("unmodified added bits")
//               .select("added bits", {}, "added")
//               .deselect("manual entity", {entity: ["added", "entity"]})
//               .project({entity: ["added", "entity"], content: ["added", "content"]}));
// eve.asView(eve.query("parsed eavs")
//             .select("entity", {}, "entity")
//             .calculate("parse eavs", {entity: ["entity", "entity"], text: ["entity", "content"]}, "parsed")
//             .project({entity: ["entity", "entity"], attribute: ["parsed", "attribute"], value: ["parsed", "value"]}));
// eve.asView(eve.union("entity eavs")
//             .union("added collections", {entity: ["entity"], attribute: "is a", value: ["collection"]})
//             .union("parsed eavs", {entity: ["entity"], attribute: ["attribute"], value: ["value"]})
//             // this is a stored union that is used by the add eav action to take query results and
//             // push them into eavs, e.g. sum salaries per department -> [total salary = *]
//             .union("added eavs", {entity: ["entity"], attribute: ["attribute"], value: ["value"]}));
// eve.asView(eve.query("is a attributes")
//               .select("entity eavs", {attribute: "is a"}, "is a")
//               .project({collection: ["is a", "value"], entity: ["is a", "entity"]}));
// @HACK: this view is required because you can't currently join a select on the result of a function.
// so we create a version of the eavs table that already has everything lowercased.
// eve.asView(eve.query("lowercase eavs")
//               .select("entity eavs", {}, "eav")
//               .calculate("lowercase", {text: ["eav", "value"]}, "lower")
//               .project({entity: ["eav", "entity"], attribute: ["eav", "attribute"], value: ["lower", "result"]}));
// eve.asView(eve.query("entity links")
//               .select("lowercase eavs", {}, "eav")
//               .select("entity", {entity: ["eav", "value"]}, "entity")
//               .project({entity: ["eav", "entity"], link: ["entity", "entity"], type: ["eav", "attribute"]}));
// eve.asView(eve.union("directionless links")
//               .union("entity links", {entity: ["entity"], link: ["link"]})
//               .union("entity links", {entity: ["link"], link: ["entity"]}));
// eve.asView(eve.union("collection entities")
//             // the rest of these are editor-level views
//             .union("is a attributes", {entity: ["entity"], collection: ["collection"]})
//             // this is a stored union that is used by the add to collection action to take query results and
//             // push them into collections, e.g. people older than 21 -> [[can drink]]
//             .union("added collections", {entity: ["entity"], collection: ["collection"]}));
// eve.asView(eve.query("collection")
//             .select("collection entities", {}, "collections")
//             .group([["collections", "collection"]])
//             .aggregate("count", {}, "count")
//             .project({collection: ["collections", "collection"], count: ["count", "count"]}));
// eve.asView(eve.query("automatic collection entities")
//               .select("collection", {}, "coll")
//               .deselect("manual entity", {entity: ["coll", "collection"]})
//               .calculate("collection content", {collection: ["coll", "collection"]}, "content")
//               .project({entity: ["coll", "collection"], content: ["content", "content"]}));
//---------------------------------------------------------
// Go
//---------------------------------------------------------
function initSearches() {
    for (var _i = 0, _a = app_1.eve.find("builtin search"); _i < _a.length; _i++) {
        var search = _a[_i];
        var value = app_1.eve.findOne("builtin search query", { id: search.id })["search"];
        app.activeSearches[search.id] = queryParser_1.queryToExecutable(value);
    }
    for (var _b = 0, _c = app_1.eve.find("ui pane"); _b < _c.length; _b++) {
        var pane = _c[_b];
        if (app_1.eve.findOne("entity", { entity: pane.contains }))
            continue;
        app.activeSearches[pane.contains] = queryParser_1.queryToExecutable(pane.contains);
    }
}
// @TODO: KILL ME
require("./bootstrap");
function initEve() {
    var stored = localStorage[app.eveLocalStorageKey];
    if (!stored) {
        var diff = app_1.eve.diff();
        var id = uuid();
        diff.add("builtin search", { id: id, top: 100, left: 100 });
        diff.add("builtin search query", { id: id, search: "foo" });
        app_1.eve.applyDiffIncremental(diff);
    }
    initSearches();
}
app.renderRoots["wiki"] = root;
app.init("wiki", function () {
    document.body.classList.add(localStorage["theme"] || "light");
    app.activeSearches = {};
    initEve();
});
window["wiki"] = exports;

},{"../vendor/marked":16,"./app":2,"./bootstrap":3,"./microReact":4,"./queryParser":6,"./runtime":8,"./ui":10,"./utils":12}],14:[function(require,module,exports){

},{}],15:[function(require,module,exports){
arguments[4][14][0].apply(exports,arguments)
},{"dup":14}],16:[function(require,module,exports){
(function (global){
/**
 * marked - a markdown parser
 * Copyright (c) 2011-2014, Christopher Jeffrey. (MIT Licensed)
 * https://github.com/chjj/marked
 */
(function(){var block={newline:/^\n+/,code:/^( {4}[^\n]+\n*)+/,fences:noop,hr:/^( *[-*_]){3,} *(?:\n+|$)/,heading:/^ *(#{1,6}) *([^\n]+?) *#* *(?:\n+|$)/,nptable:noop,lheading:/^([^\n]+)\n *(=|-){2,} *(?:\n+|$)/,blockquote:/^( *>[^\n]+(\n(?!def)[^\n]+)*\n*)+/,list:/^( *)(bull) [\s\S]+?(?:hr|def|\n{2,}(?! )(?!\1bull )\n*|\s*$)/,html:/^ *(?:comment *(?:\n|\s*$)|closed *(?:\n{2,}|\s*$)|closing *(?:\n{2,}|\s*$))/,def:/^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +["(]([^\n]+)[")])? *(?:\n+|$)/,table:noop,paragraph:/^((?:[^\n]+\n?(?!hr|heading|lheading|blockquote|tag|def))+)\n*/,text:/^[^\n]+/};block.bullet=/(?:[*+-]|\d+\.)/;block.item=/^( *)(bull) [^\n]*(?:\n(?!\1bull )[^\n]*)*/;block.item=replace(block.item,"gm")(/bull/g,block.bullet)();block.list=replace(block.list)(/bull/g,block.bullet)("hr","\\n+(?=\\1?(?:[-*_] *){3,}(?:\\n+|$))")("def","\\n+(?="+block.def.source+")")();block.blockquote=replace(block.blockquote)("def",block.def)();block._tag="(?!(?:"+"a|em|strong|small|s|cite|q|dfn|abbr|data|time|code"+"|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo"+"|span|br|wbr|ins|del|img)\\b)\\w+(?!:/|[^\\w\\s@]*@)\\b";block.html=replace(block.html)("comment",/<!--[\s\S]*?-->/)("closed",/<(tag)[\s\S]+?<\/\1>/)("closing",/<tag(?:"[^"]*"|'[^']*'|[^'">])*?>/)(/tag/g,block._tag)();block.paragraph=replace(block.paragraph)("hr",block.hr)("heading",block.heading)("lheading",block.lheading)("blockquote",block.blockquote)("tag","<"+block._tag)("def",block.def)();block.normal=merge({},block);block.gfm=merge({},block.normal,{fences:/^ *(`{3,}|~{3,})[ \.]*(\S+)? *\n([\s\S]*?)\s*\1 *(?:\n+|$)/,paragraph:/^/,heading:/^ *(#{1,6}) +([^\n]+?) *#* *(?:\n+|$)/});block.gfm.paragraph=replace(block.paragraph)("(?!","(?!"+block.gfm.fences.source.replace("\\1","\\2")+"|"+block.list.source.replace("\\1","\\3")+"|")();block.tables=merge({},block.gfm,{nptable:/^ *(\S.*\|.*)\n *([-:]+ *\|[-| :]*)\n((?:.*\|.*(?:\n|$))*)\n*/,table:/^ *\|(.+)\n *\|( *[-:]+[-| :]*)\n((?: *\|.*(?:\n|$))*)\n*/});function Lexer(options){this.tokens=[];this.tokens.links={};this.options=options||marked.defaults;this.rules=block.normal;if(this.options.gfm){if(this.options.tables){this.rules=block.tables}else{this.rules=block.gfm}}}Lexer.rules=block;Lexer.lex=function(src,options){var lexer=new Lexer(options);return lexer.lex(src)};Lexer.prototype.lex=function(src){src=src.replace(/\r\n|\r/g,"\n").replace(/\t/g,"    ").replace(/\u00a0/g," ").replace(/\u2424/g,"\n");return this.token(src,true)};Lexer.prototype.token=function(src,top,bq){var src=src.replace(/^ +$/gm,""),next,loose,cap,bull,b,item,space,i,l;while(src){if(cap=this.rules.newline.exec(src)){src=src.substring(cap[0].length);if(cap[0].length>1){this.tokens.push({type:"space"})}}if(cap=this.rules.code.exec(src)){src=src.substring(cap[0].length);cap=cap[0].replace(/^ {4}/gm,"");this.tokens.push({type:"code",text:!this.options.pedantic?cap.replace(/\n+$/,""):cap});continue}if(cap=this.rules.fences.exec(src)){src=src.substring(cap[0].length);this.tokens.push({type:"code",lang:cap[2],text:cap[3]||""});continue}if(cap=this.rules.heading.exec(src)){src=src.substring(cap[0].length);this.tokens.push({type:"heading",depth:cap[1].length,text:cap[2]});continue}if(top&&(cap=this.rules.nptable.exec(src))){src=src.substring(cap[0].length);item={type:"table",header:cap[1].replace(/^ *| *\| *$/g,"").split(/ *\| */),align:cap[2].replace(/^ *|\| *$/g,"").split(/ *\| */),cells:cap[3].replace(/\n$/,"").split("\n")};for(i=0;i<item.align.length;i++){if(/^ *-+: *$/.test(item.align[i])){item.align[i]="right"}else if(/^ *:-+: *$/.test(item.align[i])){item.align[i]="center"}else if(/^ *:-+ *$/.test(item.align[i])){item.align[i]="left"}else{item.align[i]=null}}for(i=0;i<item.cells.length;i++){item.cells[i]=item.cells[i].split(/ *\| */)}this.tokens.push(item);continue}if(cap=this.rules.lheading.exec(src)){src=src.substring(cap[0].length);this.tokens.push({type:"heading",depth:cap[2]==="="?1:2,text:cap[1]});continue}if(cap=this.rules.hr.exec(src)){src=src.substring(cap[0].length);this.tokens.push({type:"hr"});continue}if(cap=this.rules.blockquote.exec(src)){src=src.substring(cap[0].length);this.tokens.push({type:"blockquote_start"});cap=cap[0].replace(/^ *> ?/gm,"");this.token(cap,top,true);this.tokens.push({type:"blockquote_end"});continue}if(cap=this.rules.list.exec(src)){src=src.substring(cap[0].length);bull=cap[2];this.tokens.push({type:"list_start",ordered:bull.length>1});cap=cap[0].match(this.rules.item);next=false;l=cap.length;i=0;for(;i<l;i++){item=cap[i];space=item.length;item=item.replace(/^ *([*+-]|\d+\.) +/,"");if(~item.indexOf("\n ")){space-=item.length;item=!this.options.pedantic?item.replace(new RegExp("^ {1,"+space+"}","gm"),""):item.replace(/^ {1,4}/gm,"")}if(this.options.smartLists&&i!==l-1){b=block.bullet.exec(cap[i+1])[0];if(bull!==b&&!(bull.length>1&&b.length>1)){src=cap.slice(i+1).join("\n")+src;i=l-1}}loose=next||/\n\n(?!\s*$)/.test(item);if(i!==l-1){next=item.charAt(item.length-1)==="\n";if(!loose)loose=next}this.tokens.push({type:loose?"loose_item_start":"list_item_start"});this.token(item,false,bq);this.tokens.push({type:"list_item_end"})}this.tokens.push({type:"list_end"});continue}if(cap=this.rules.html.exec(src)){src=src.substring(cap[0].length);this.tokens.push({type:this.options.sanitize?"paragraph":"html",pre:!this.options.sanitizer&&(cap[1]==="pre"||cap[1]==="script"||cap[1]==="style"),text:cap[0]});continue}if(!bq&&top&&(cap=this.rules.def.exec(src))){src=src.substring(cap[0].length);this.tokens.links[cap[1].toLowerCase()]={href:cap[2],title:cap[3]};continue}if(top&&(cap=this.rules.table.exec(src))){src=src.substring(cap[0].length);item={type:"table",header:cap[1].replace(/^ *| *\| *$/g,"").split(/ *\| */),align:cap[2].replace(/^ *|\| *$/g,"").split(/ *\| */),cells:cap[3].replace(/(?: *\| *)?\n$/,"").split("\n")};for(i=0;i<item.align.length;i++){if(/^ *-+: *$/.test(item.align[i])){item.align[i]="right"}else if(/^ *:-+: *$/.test(item.align[i])){item.align[i]="center"}else if(/^ *:-+ *$/.test(item.align[i])){item.align[i]="left"}else{item.align[i]=null}}for(i=0;i<item.cells.length;i++){item.cells[i]=item.cells[i].replace(/^ *\| *| *\| *$/g,"").split(/ *\| */)}this.tokens.push(item);continue}if(top&&(cap=this.rules.paragraph.exec(src))){src=src.substring(cap[0].length);this.tokens.push({type:"paragraph",text:cap[1].charAt(cap[1].length-1)==="\n"?cap[1].slice(0,-1):cap[1]});continue}if(cap=this.rules.text.exec(src)){src=src.substring(cap[0].length);this.tokens.push({type:"text",text:cap[0]});continue}if(src){throw new Error("Infinite loop on byte: "+src.charCodeAt(0))}}return this.tokens};var inline={escape:/^\\([\\`*{}\[\]()#+\-.!_>])/,autolink:/^<([^ >]+(@|:\/)[^ >]+)>/,url:noop,tag:/^<!--[\s\S]*?-->|^<\/?\w+(?:"[^"]*"|'[^']*'|[^'">])*?>/,link:/^!?\[(inside)\]\(href\)/,reflink:/^!?\[(inside)\]\s*\[([^\]]*)\]/,nolink:/^!?\[((?:\[[^\]]*\]|[^\[\]])*)\]/,strong:/^__([\s\S]+?)__(?!_)|^\*\*([\s\S]+?)\*\*(?!\*)/,em:/^\b_((?:[^_]|__)+?)_\b|^\*((?:\*\*|[\s\S])+?)\*(?!\*)/,code:/^(`+)\s*([\s\S]*?[^`])\s*\1(?!`)/,br:/^ {2,}\n(?!\s*$)/,del:noop,text:/^[\s\S]+?(?=[\\<!\[_*`]| {2,}\n|$)/};inline._inside=/(?:\[[^\]]*\]|[^\[\]]|\](?=[^\[]*\]))*/;inline._href=/\s*<?([\s\S]*?)>?(?:\s+['"]([\s\S]*?)['"])?\s*/;inline.link=replace(inline.link)("inside",inline._inside)("href",inline._href)();inline.reflink=replace(inline.reflink)("inside",inline._inside)();inline.normal=merge({},inline);inline.pedantic=merge({},inline.normal,{strong:/^__(?=\S)([\s\S]*?\S)__(?!_)|^\*\*(?=\S)([\s\S]*?\S)\*\*(?!\*)/,em:/^_(?=\S)([\s\S]*?\S)_(?!_)|^\*(?=\S)([\s\S]*?\S)\*(?!\*)/});inline.gfm=merge({},inline.normal,{escape:replace(inline.escape)("])","~|])")(),url:/^(https?:\/\/[^\s<]+[^<.,:;"')\]\s])/,del:/^~~(?=\S)([\s\S]*?\S)~~/,text:replace(inline.text)("]|","~]|")("|","|https?://|")()});inline.breaks=merge({},inline.gfm,{br:replace(inline.br)("{2,}","*")(),text:replace(inline.gfm.text)("{2,}","*")()});function InlineLexer(links,options){this.options=options||marked.defaults;this.links=links;this.rules=inline.normal;this.renderer=this.options.renderer||new Renderer;this.renderer.options=this.options;if(!this.links){throw new Error("Tokens array requires a `links` property.")}if(this.options.gfm){if(this.options.breaks){this.rules=inline.breaks}else{this.rules=inline.gfm}}else if(this.options.pedantic){this.rules=inline.pedantic}}InlineLexer.rules=inline;InlineLexer.output=function(src,links,options){var inline=new InlineLexer(links,options);return inline.output(src)};InlineLexer.prototype.output=function(src){var out="",link,text,href,cap;while(src){if(cap=this.rules.escape.exec(src)){src=src.substring(cap[0].length);out+=cap[1];continue}if(cap=this.rules.autolink.exec(src)){src=src.substring(cap[0].length);if(cap[2]==="@"){text=cap[1].charAt(6)===":"?this.mangle(cap[1].substring(7)):this.mangle(cap[1]);href=this.mangle("mailto:")+text}else{text=escape(cap[1]);href=text}out+=this.renderer.link(href,null,text);continue}if(!this.inLink&&(cap=this.rules.url.exec(src))){src=src.substring(cap[0].length);text=escape(cap[1]);href=text;out+=this.renderer.link(href,null,text);continue}if(cap=this.rules.tag.exec(src)){if(!this.inLink&&/^<a /i.test(cap[0])){this.inLink=true}else if(this.inLink&&/^<\/a>/i.test(cap[0])){this.inLink=false}src=src.substring(cap[0].length);out+=this.options.sanitize?this.options.sanitizer?this.options.sanitizer(cap[0]):escape(cap[0]):cap[0];continue}if(cap=this.rules.link.exec(src)){src=src.substring(cap[0].length);this.inLink=true;out+=this.outputLink(cap,{href:cap[2],title:cap[3]});this.inLink=false;continue}if((cap=this.rules.reflink.exec(src))||(cap=this.rules.nolink.exec(src))){src=src.substring(cap[0].length);link=(cap[2]||cap[1]).replace(/\s+/g," ");link=this.links[link.toLowerCase()];if(!link||!link.href){out+=cap[0].charAt(0);src=cap[0].substring(1)+src;continue}this.inLink=true;out+=this.outputLink(cap,link);this.inLink=false;continue}if(cap=this.rules.strong.exec(src)){src=src.substring(cap[0].length);out+=this.renderer.strong(this.output(cap[2]||cap[1]));continue}if(cap=this.rules.em.exec(src)){src=src.substring(cap[0].length);out+=this.renderer.em(this.output(cap[2]||cap[1]));continue}if(cap=this.rules.code.exec(src)){src=src.substring(cap[0].length);out+=this.renderer.codespan(escape(cap[2],true));continue}if(cap=this.rules.br.exec(src)){src=src.substring(cap[0].length);out+=this.renderer.br();continue}if(cap=this.rules.del.exec(src)){src=src.substring(cap[0].length);out+=this.renderer.del(this.output(cap[1]));continue}if(cap=this.rules.text.exec(src)){src=src.substring(cap[0].length);out+=this.renderer.text(escape(this.smartypants(cap[0])));continue}if(src){throw new Error("Infinite loop on byte: "+src.charCodeAt(0))}}return out};InlineLexer.prototype.outputLink=function(cap,link){var href=escape(link.href),title=link.title?escape(link.title):null;return cap[0].charAt(0)!=="!"?this.renderer.link(href,title,this.output(cap[1])):this.renderer.image(href,title,escape(cap[1]))};InlineLexer.prototype.smartypants=function(text){if(!this.options.smartypants)return text;return text.replace(/---/g,"—").replace(/--/g,"–").replace(/(^|[-\u2014/(\[{"\s])'/g,"$1‘").replace(/'/g,"’").replace(/(^|[-\u2014/(\[{\u2018\s])"/g,"$1“").replace(/"/g,"”").replace(/\.{3}/g,"…")};InlineLexer.prototype.mangle=function(text){if(!this.options.mangle)return text;var out="",l=text.length,i=0,ch;for(;i<l;i++){ch=text.charCodeAt(i);if(Math.random()>.5){ch="x"+ch.toString(16)}out+="&#"+ch+";"}return out};function Renderer(options){this.options=options||{}}Renderer.prototype.code=function(code,lang,escaped){if(this.options.highlight){var out=this.options.highlight(code,lang);if(out!=null&&out!==code){escaped=true;code=out}}if(!lang){return"<pre><code>"+(escaped?code:escape(code,true))+"\n</code></pre>"}return'<pre><code class="'+this.options.langPrefix+escape(lang,true)+'">'+(escaped?code:escape(code,true))+"\n</code></pre>\n"};Renderer.prototype.blockquote=function(quote){return"<blockquote>\n"+quote+"</blockquote>\n"};Renderer.prototype.html=function(html){return html};Renderer.prototype.heading=function(text,level,raw){return"<h"+level+' id="'+this.options.headerPrefix+raw.toLowerCase().replace(/[^\w]+/g,"-")+'">'+text+"</h"+level+">\n"};Renderer.prototype.hr=function(){return this.options.xhtml?"<hr/>\n":"<hr>\n"};Renderer.prototype.list=function(body,ordered){var type=ordered?"ol":"ul";return"<"+type+">\n"+body+"</"+type+">\n"};Renderer.prototype.listitem=function(text){return"<li>"+text+"</li>\n"};Renderer.prototype.paragraph=function(text){return"<p>"+text+"</p>\n"};Renderer.prototype.table=function(header,body){return"<table>\n"+"<thead>\n"+header+"</thead>\n"+"<tbody>\n"+body+"</tbody>\n"+"</table>\n"};Renderer.prototype.tablerow=function(content){return"<tr>\n"+content+"</tr>\n"};Renderer.prototype.tablecell=function(content,flags){var type=flags.header?"th":"td";var tag=flags.align?"<"+type+' style="text-align:'+flags.align+'">':"<"+type+">";return tag+content+"</"+type+">\n"};Renderer.prototype.strong=function(text){return"<strong>"+text+"</strong>"};Renderer.prototype.em=function(text){return"<em>"+text+"</em>"};Renderer.prototype.codespan=function(text){return"<code>"+text+"</code>"};Renderer.prototype.br=function(){return this.options.xhtml?"<br/>":"<br>"};Renderer.prototype.del=function(text){return"<del>"+text+"</del>"};Renderer.prototype.link=function(href,title,text){if(this.options.sanitize){try{var prot=decodeURIComponent(unescape(href)).replace(/[^\w:]/g,"").toLowerCase()}catch(e){return""}if(prot.indexOf("javascript:")===0||prot.indexOf("vbscript:")===0){return""}}var out='<a href="'+href+'"';if(title){out+=' title="'+title+'"'}out+=">"+text+"</a>";return out};Renderer.prototype.image=function(href,title,text){var out='<img src="'+href+'" alt="'+text+'"';if(title){out+=' title="'+title+'"'}out+=this.options.xhtml?"/>":">";return out};Renderer.prototype.text=function(text){return text};function Parser(options){this.tokens=[];this.token=null;this.options=options||marked.defaults;this.options.renderer=this.options.renderer||new Renderer;this.renderer=this.options.renderer;this.renderer.options=this.options}Parser.parse=function(src,options,renderer){var parser=new Parser(options,renderer);return parser.parse(src)};Parser.prototype.parse=function(src){this.inline=new InlineLexer(src.links,this.options,this.renderer);this.tokens=src.reverse();var out="";while(this.next()){out+=this.tok()}return out};Parser.prototype.next=function(){return this.token=this.tokens.pop()};Parser.prototype.peek=function(){return this.tokens[this.tokens.length-1]||0};Parser.prototype.parseText=function(){var body=this.token.text;while(this.peek().type==="text"){body+="\n"+this.next().text}return this.inline.output(body)};Parser.prototype.tok=function(){switch(this.token.type){case"space":{return""}case"hr":{return this.renderer.hr()}case"heading":{return this.renderer.heading(this.inline.output(this.token.text),this.token.depth,this.token.text)}case"code":{return this.renderer.code(this.token.text,this.token.lang,this.token.escaped)}case"table":{var header="",body="",i,row,cell,flags,j;cell="";for(i=0;i<this.token.header.length;i++){flags={header:true,align:this.token.align[i]};cell+=this.renderer.tablecell(this.inline.output(this.token.header[i]),{header:true,align:this.token.align[i]})}header+=this.renderer.tablerow(cell);for(i=0;i<this.token.cells.length;i++){row=this.token.cells[i];cell="";for(j=0;j<row.length;j++){cell+=this.renderer.tablecell(this.inline.output(row[j]),{header:false,align:this.token.align[j]})}body+=this.renderer.tablerow(cell)}return this.renderer.table(header,body)}case"blockquote_start":{var body="";while(this.next().type!=="blockquote_end"){body+=this.tok()}return this.renderer.blockquote(body)}case"list_start":{var body="",ordered=this.token.ordered;while(this.next().type!=="list_end"){body+=this.tok()}return this.renderer.list(body,ordered)}case"list_item_start":{var body="";while(this.next().type!=="list_item_end"){body+=this.token.type==="text"?this.parseText():this.tok()}return this.renderer.listitem(body)}case"loose_item_start":{var body="";while(this.next().type!=="list_item_end"){body+=this.tok()}return this.renderer.listitem(body)}case"html":{var html=!this.token.pre&&!this.options.pedantic?this.inline.output(this.token.text):this.token.text;return this.renderer.html(html)}case"paragraph":{return this.renderer.paragraph(this.inline.output(this.token.text))}case"text":{return this.renderer.paragraph(this.parseText())}}};function escape(html,encode){return html.replace(!encode?/&(?!#?\w+;)/g:/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function unescape(html){return html.replace(/&([#\w]+);/g,function(_,n){n=n.toLowerCase();if(n==="colon")return":";if(n.charAt(0)==="#"){return n.charAt(1)==="x"?String.fromCharCode(parseInt(n.substring(2),16)):String.fromCharCode(+n.substring(1))}return""})}function replace(regex,opt){regex=regex.source;opt=opt||"";return function self(name,val){if(!name)return new RegExp(regex,opt);val=val.source||val;val=val.replace(/(^|[^\[])\^/g,"$1");regex=regex.replace(name,val);return self}}function noop(){}noop.exec=noop;function merge(obj){var i=1,target,key;for(;i<arguments.length;i++){target=arguments[i];for(key in target){if(Object.prototype.hasOwnProperty.call(target,key)){obj[key]=target[key]}}}return obj}function marked(src,opt,callback){if(callback||typeof opt==="function"){if(!callback){callback=opt;opt=null}opt=merge({},marked.defaults,opt||{});var highlight=opt.highlight,tokens,pending,i=0;try{tokens=Lexer.lex(src,opt)}catch(e){return callback(e)}pending=tokens.length;var done=function(err){if(err){opt.highlight=highlight;return callback(err)}var out;try{out=Parser.parse(tokens,opt)}catch(e){err=e}opt.highlight=highlight;return err?callback(err):callback(null,out)};if(!highlight||highlight.length<3){return done()}delete opt.highlight;if(!pending)return done();for(;i<tokens.length;i++){(function(token){if(token.type!=="code"){return--pending||done()}return highlight(token.text,token.lang,function(err,code){if(err)return done(err);if(code==null||code===token.text){return--pending||done()}token.text=code;token.escaped=true;--pending||done()})})(tokens[i])}return}try{if(opt)opt=merge({},marked.defaults,opt);return Parser.parse(Lexer.lex(src,opt),opt)}catch(e){e.message+="\nPlease report this to https://github.com/chjj/marked.";if((opt||marked.defaults).silent){return"<p>An error occured:</p><pre>"+escape(e.message+"",true)+"</pre>"}throw e}}marked.options=marked.setOptions=function(opt){merge(marked.defaults,opt);return marked};marked.defaults={gfm:true,tables:true,breaks:false,pedantic:false,sanitize:false,sanitizer:null,mangle:true,smartLists:false,silent:false,highlight:null,langPrefix:"lang-",smartypants:false,headerPrefix:"",renderer:new Renderer,xhtml:false};marked.Parser=Parser;marked.parser=Parser.parse;marked.Renderer=Renderer;marked.Lexer=Lexer;marked.lexer=Lexer.lex;marked.InlineLexer=InlineLexer;marked.inlineLexer=InlineLexer.output;marked.parse=marked;if(typeof module!=="undefined"&&typeof exports==="object"){module.exports=marked}else if(typeof define==="function"&&define.amd){define(function(){return marked})}else{this.marked=marked}}).call(function(){return this||(typeof window!=="undefined"?window:global)}());
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{}],17:[function(require,module,exports){
//     uuid.js
//
//     Copyright (c) 2010-2012 Robert Kieffer
//     MIT License - http://opensource.org/licenses/mit-license.php

(function() {
  var _global = this;

  // Unique ID creation requires a high quality random # generator.  We feature
  // detect to determine the best RNG source, normalizing to a function that
  // returns 128-bits of randomness, since that's what's usually required
  var _rng;

  // Node.js crypto-based RNG - http://nodejs.org/docs/v0.6.2/api/crypto.html
  //
  // Moderately fast, high quality
  if (typeof(_global.require) == 'function') {
    try {
      var _rb = _global.require('crypto').randomBytes;
      _rng = _rb && function() {return _rb(16);};
    } catch(e) {}
  }

  if (!_rng && _global.crypto && crypto.getRandomValues) {
    // WHATWG crypto-based RNG - http://wiki.whatwg.org/wiki/Crypto
    //
    // Moderately fast, high quality
    var _rnds8 = new Uint8Array(16);
    _rng = function whatwgRNG() {
      crypto.getRandomValues(_rnds8);
      return _rnds8;
    };
  }

  if (!_rng) {
    // Math.random()-based (RNG)
    //
    // If all else fails, use Math.random().  It's fast, but is of unspecified
    // quality.
    var  _rnds = new Array(16);
    _rng = function() {
      for (var i = 0, r; i < 16; i++) {
        if ((i & 0x03) === 0) r = Math.random() * 0x100000000;
        _rnds[i] = r >>> ((i & 0x03) << 3) & 0xff;
      }

      return _rnds;
    };
  }

  // Buffer class to use
  var BufferClass = typeof(_global.Buffer) == 'function' ? _global.Buffer : Array;

  // Maps for number <-> hex string conversion
  var _byteToHex = [];
  var _hexToByte = {};
  for (var i = 0; i < 256; i++) {
    _byteToHex[i] = (i + 0x100).toString(16).substr(1);
    _hexToByte[_byteToHex[i]] = i;
  }

  // **`parse()` - Parse a UUID into it's component bytes**
  function parse(s, buf, offset) {
    var i = (buf && offset) || 0, ii = 0;

    buf = buf || [];
    s.toLowerCase().replace(/[0-9a-f]{2}/g, function(oct) {
      if (ii < 16) { // Don't overflow!
        buf[i + ii++] = _hexToByte[oct];
      }
    });

    // Zero out remaining bytes if string was short
    while (ii < 16) {
      buf[i + ii++] = 0;
    }

    return buf;
  }

  // **`unparse()` - Convert UUID byte array (ala parse()) into a string**
  function unparse(buf, offset) {
    var i = offset || 0, bth = _byteToHex;
    return  bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] + '-' +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]] +
            bth[buf[i++]] + bth[buf[i++]];
  }

  // **`v1()` - Generate time-based UUID**
  //
  // Inspired by https://github.com/LiosK/UUID.js
  // and http://docs.python.org/library/uuid.html

  // random #'s we need to init node and clockseq
  var _seedBytes = _rng();

  // Per 4.5, create and 48-bit node id, (47 random bits + multicast bit = 1)
  var _nodeId = [
    _seedBytes[0] | 0x01,
    _seedBytes[1], _seedBytes[2], _seedBytes[3], _seedBytes[4], _seedBytes[5]
  ];

  // Per 4.2.2, randomize (14 bit) clockseq
  var _clockseq = (_seedBytes[6] << 8 | _seedBytes[7]) & 0x3fff;

  // Previous uuid creation time
  var _lastMSecs = 0, _lastNSecs = 0;

  // See https://github.com/broofa/node-uuid for API details
  function v1(options, buf, offset) {
    var i = buf && offset || 0;
    var b = buf || [];

    options = options || {};

    var clockseq = options.clockseq != null ? options.clockseq : _clockseq;

    // UUID timestamps are 100 nano-second units since the Gregorian epoch,
    // (1582-10-15 00:00).  JSNumbers aren't precise enough for this, so
    // time is handled internally as 'msecs' (integer milliseconds) and 'nsecs'
    // (100-nanoseconds offset from msecs) since unix epoch, 1970-01-01 00:00.
    var msecs = options.msecs != null ? options.msecs : new Date().getTime();

    // Per 4.2.1.2, use count of uuid's generated during the current clock
    // cycle to simulate higher resolution clock
    var nsecs = options.nsecs != null ? options.nsecs : _lastNSecs + 1;

    // Time since last uuid creation (in msecs)
    var dt = (msecs - _lastMSecs) + (nsecs - _lastNSecs)/10000;

    // Per 4.2.1.2, Bump clockseq on clock regression
    if (dt < 0 && options.clockseq == null) {
      clockseq = clockseq + 1 & 0x3fff;
    }

    // Reset nsecs if clock regresses (new clockseq) or we've moved onto a new
    // time interval
    if ((dt < 0 || msecs > _lastMSecs) && options.nsecs == null) {
      nsecs = 0;
    }

    // Per 4.2.1.2 Throw error if too many uuids are requested
    if (nsecs >= 10000) {
      throw new Error('uuid.v1(): Can\'t create more than 10M uuids/sec');
    }

    _lastMSecs = msecs;
    _lastNSecs = nsecs;
    _clockseq = clockseq;

    // Per 4.1.4 - Convert from unix epoch to Gregorian epoch
    msecs += 12219292800000;

    // `time_low`
    var tl = ((msecs & 0xfffffff) * 10000 + nsecs) % 0x100000000;
    b[i++] = tl >>> 24 & 0xff;
    b[i++] = tl >>> 16 & 0xff;
    b[i++] = tl >>> 8 & 0xff;
    b[i++] = tl & 0xff;

    // `time_mid`
    var tmh = (msecs / 0x100000000 * 10000) & 0xfffffff;
    b[i++] = tmh >>> 8 & 0xff;
    b[i++] = tmh & 0xff;

    // `time_high_and_version`
    b[i++] = tmh >>> 24 & 0xf | 0x10; // include version
    b[i++] = tmh >>> 16 & 0xff;

    // `clock_seq_hi_and_reserved` (Per 4.2.2 - include variant)
    b[i++] = clockseq >>> 8 | 0x80;

    // `clock_seq_low`
    b[i++] = clockseq & 0xff;

    // `node`
    var node = options.node || _nodeId;
    for (var n = 0; n < 6; n++) {
      b[i + n] = node[n];
    }

    return buf ? buf : unparse(b);
  }

  // **`v4()` - Generate random UUID**

  // See https://github.com/broofa/node-uuid for API details
  function v4(options, buf, offset) {
    // Deprecated - 'format' argument, as supported in v1.2
    var i = buf && offset || 0;

    if (typeof(options) == 'string') {
      buf = options == 'binary' ? new BufferClass(16) : null;
      options = null;
    }
    options = options || {};

    var rnds = options.random || (options.rng || _rng)();

    // Per 4.4, set bits for version and `clock_seq_hi_and_reserved`
    rnds[6] = (rnds[6] & 0x0f) | 0x40;
    rnds[8] = (rnds[8] & 0x3f) | 0x80;

    // Copy bytes to buffer, if provided
    if (buf) {
      for (var ii = 0; ii < 16; ii++) {
        buf[i + ii] = rnds[ii];
      }
    }

    return buf || unparse(rnds);
  }

  // Export public API
  var uuid = v4;
  uuid.v1 = v1;
  uuid.v4 = v4;
  uuid.parse = parse;
  uuid.unparse = unparse;
  uuid.BufferClass = BufferClass;

  if (typeof define === 'function' && define.amd) {
    // Publish as AMD module
    define(function() {return uuid;});
  } else if (typeof(module) != 'undefined' && module.exports) {
    // Publish as node.js module
    module.exports = uuid;
  } else {
    // Publish as global (in browsers)
    var _previousRoot = _global.uuid;

    // **`noConflict()` - (browser only) to reset global 'uuid' var**
    uuid.noConflict = function() {
      _global.uuid = _previousRoot;
      return uuid;
    };

    _global.uuid = uuid;
  }
}).call(this);

},{}]},{},[9,14,15])