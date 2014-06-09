if (typeof Set != "function") {
  // This is a horrible and incomplete polyfill implementation for ES6 Set. Deal
  // with it.

  (typeof global == "object" ? global : this).Set = (function () {
    var push = Array.prototype.push;
    var indexOf = Array.prototype.indexOf;

    function Set() {
      this._items = [];
    };

    Set.prototype.add = function (x) {
      push.call(this._items, x);
    };

    Set.prototype.has = function (x) {
      return indexOf.call(this._items, x) === -1;
    };

    return Set;
  }());
}

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define(factory);
  } else if (typeof exports === "object") {
    module.exports = factory();
  } else {
    root.strace = factory();
  }
}(this, function () {
  "use strict";

  // Hold references to the original, un-instrumented natives we use inside
  // monkey punched methods so that they don't get logged all the time and/or
  // cause too-much-recursion errors.
  var log                   = console.log.bind(console);
  var trace                 = console.trace.bind(console);
  var warn                  = console.warn.bind(console);
  var functionProtoToString = Function.prototype.toString;
  var objectProtoToString   = Object.prototype.toString;
  var slice                 = Array.prototype.slice;
  var arrayProtoPush        = Array.prototype.push;
  var apply                 = Function.prototype.apply;

  function toArray(it) {
    return slice.call(it);
  }

  function push(array, item) {
    return arrayProtoPush.call(array, item);
  }

  // Matches the "function () { [native code] }" form that native functions
  // stringify to.
  var NATIVE_FUNCTION_SOURCE_REGEXP = /^\s*function \w*\([\s\S]*\)\s*\{\s*\[native code\]\s*\}\s*$/;

  // Returns true if the given thing is a native function, false otherwise.
  function isNativeFunction(thing) {
    if (typeof thing != "function") {
      return false;
    }

    try {
      return NATIVE_FUNCTION_SOURCE_REGEXP.test(functionProtoToString.call(thing));
    } catch (e) {
      return false;
    }
  }

  var TYPES = ["value", "get", "set"];
  var TYPES_LENGTH = TYPES.length;

  // To a depth first search of all objects on the heap reachable from node. The
  // visit function is called for each native function found.
  function dfs(node, seen, visit) {
    if (!node) {
      return;
    }

    seen.add(node);

    if (typeof node == "object" || typeof node == "function") {
      var edges = Object.getOwnPropertyNames(node);
      push(edges, "__proto__");

      for (var i = edges.length; i; i--) {
        var name = edges[i];

        try {
          var desc = Object.getOwnPropertyDescriptor(node, name);
        } catch(e) { }

        if (!desc) {
          warn("strace.js: Cannot read property descriptor for '%s'",
               makePrettyName(node, name, "value"));
          continue;
        }

        for (var j = 0; j < TYPES_LENGTH; j++) {
          var type = TYPES[j];
          if (desc[type]) {
            if (isNativeFunction(desc[type])) {
              visit(desc[type], node, name, type);
            }
            if (!seen.has(desc[type])) {
              dfs(desc[type], seen, visit);
            }
          }
        }
      }
    }
  }

  function makePrettyName(parent, name, type) {
    var parentName = objectProtoToString.call(parent).slice(8, -1);

    if (type == "value") {
      return parentName + "." + name;
    }

    return parentName + ".[[" + type + " " + name + "]]";
  }

  function copyProperty(func, punched, desc, name) {
    // TODO remove desc param and just get it inside here?

    if (!desc.configurable) {
      return;
    }

    if (typeof desc.value == "function") {
      var value = desc.value;
      desc.value = function () {
        return value.apply(this === punched ? func : this, arguments);
      };
    }
    if (typeof desc.set == "function") {
      var set = desc.set;
      desc.set = function () {
        return set.apply(this === punched ? func : this, arguments);
      };
    }
    if (typeof desc.get == "function") {
      var get = desc.get;
      desc.get = function () {
        return get.apply(this === punched ? func : this, arguments);
      };
    }

    Object.defineProperty(punched, name, desc);
  }

  // Instrument via monkey-punching the function `func` at `parent[name]` as
  // either a normal value, getter, or setter, depending on if `type` is
  // "value", "get", or "set" respectively.
  function punch(func, parent, name, type) {
    var desc = Object.getOwnPropertyDescriptor(parent, name);
    var prettyName = makePrettyName(parent, name, type);
    log("strace.js: Instrumenting '%s'.", prettyName);

    // For whatever reason, native methods complain about invalid `this` values
    // when we construct instances like this:
    //
    //     var d = Object.create(Date.prototype);
    //     Date.apply(d, arguments);
    //     d instanceof Date // true
    //     d.getTime()       // throws an Error!
    //
    // Hence the explicit a, b, c...
    //
    // Furthermore, some native constructors count the arguments length and do
    // different things depending on how many arguments are passed in, so we
    // have to manually pass arguments in when using `new`.
    var punched = desc[type] = function punched(a, b, c, d, e, f, g, h, i, j, k,
                                                l, m, n, o, p, q, r, s, t, u, v,
                                                w, x, y, z) {
      if (this
          && typeof this == "object"
          && punched.prototype
          && this instanceof punched) {
        if (strace.logging) {
          if (strace.loggingArguments) {
            log("new " + prettyName, toArray(arguments));
          } else {
            log("new " + prettyName);
          }
          if (strace.loggingStacks) {
            trace();
          }
        }

        switch (arguments.length) {
          case 0:
            return new func();
          case 1:
            return new func(a);
          case 2:
            return new func(a, b);
          case 3:
            return new func(a, b, c);
          case 4:
            return new func(a, b, c, d);
          case 5:
            return new func(a, b, c, d, e);
          case 6:
            return new func(a, b, c, d, e, f);
          case 7:
            return new func(a, b, c, d, e, f, g);
          case 8:
            return new func(a, b, c, d, e, f, g, h);
          case 9:
            return new func(a, b, c, d, e, f, g, h, i);
          case 10:
            return new func(a, b, c, d, e, f, g, h, i, j);
          default:
            warn("strace.js: You use too many damn arguments!");
            return new func(a, b, c, d, e, f, g, h, i, j, k,l, m, n, o, p, q, r,
                            s, t, u, v, w, x, y, z);
        }
      }

      if (strace.logging) {
        var logArgs = [prettyName];
        if (strace.loggingThis) {
          push(logArgs, this);
        }
        if (strace.loggingArguments) {
          push(logArgs, toArray(arguments));
        }
        apply.call(log, null, logArgs);
        if (strace.loggingStacks) {
          trace();
        }
      }

      return func.apply(this, arguments);
    };

    var toCopy = Object.getOwnPropertyNames(func);
    for (var i = 0, len = toCopy.length; i < len; i++) {
      copyProperty(func, punched,
                   Object.getOwnPropertyDescriptor(func, toCopy[i]), toCopy[i]);
    }

    punched.prototype = func.prototype;
    punched.__$$_strace_original_$$__ = func;

    try {
      Object.defineProperty(parent, name, desc);
    } catch (e) {
      warn("strace.js: Failed to instrument '%s'", prettyName);
    }
  }

  function findNatives(root, seen) {
    var natives = [];

    dfs(root, seen, function (func, parent, name, type) {
      push(natives, {
        func: func,
        parent: parent,
        name: name,
        type: type
      });
    });

    return natives;
  }

  // The set of nodes in the heap we have already visited and, if the node is a
  // native function, already instrumented.
  var seen = new Set();

  // === PUBLIC API ============================================================

  // Instrument all native functions reachable from `root`.
  function strace(root) {
    var toPunch = findNatives(root, seen);

    for (var i = 0, len = toPunch.length; i < len; i++) {
      var f = toPunch[i];
      punch(f.func, f.parent, f.name, f.type);
    }
  }

  // Controls whether native calls are logged to the console.
  strace.logging = true;

  // If strace.logging is true, controls whether the callstack is also logged to
  // the console.
  strace.loggingStacks = true;

  // If strace.logging is true, controls whether the `this` value is logged to
  // the console.
  strace.loggingThis = true;

  // If strace.logging is true, controls whether arguments are also logged to
  // the console.
  strace.loggingArguments = true;

  // Clears strace's aggregated data.
  strace.clear = function () {
    TODO;
  };

  // Logs a summary of aggregated data.
  strace.summary = function () {
    TODO;
  };

  return strace;

}));
