import run from "ember-metal/run_loop";
import { get } from "ember-metal/property_get";
import { set } from "ember-metal/property_set";
import {
  _instrumentStart,
  subscribers
} from "ember-metal/instrumentation";
import buildComponentTemplate from "ember-views/system/build-component-template";
import { indexOf } from "ember-metal/enumerable_utils";
//import { deprecation } from "ember-views/compat/attrs-proxy";

function Renderer(_helper) {
  this._dom = _helper;
}

Renderer.prototype.prerenderTopLevelView =
  function Renderer_prerenderTopLevelView(view, renderNode) {
    if (view._state === 'inDOM') {
      throw new Error("You cannot insert a View that has already been rendered");
    }
    view.ownerView = renderNode.emberView = view;
    view._renderNode = renderNode;

    var layout = get(view, 'layout');
    var template = get(view, 'template');

    var componentInfo = { component: view, layout: layout };

    var block = buildComponentTemplate(componentInfo, {}, {
      self: view,
      template: template && template.raw
    }).block;

    view.renderBlock(block, renderNode);
    view.lastResult = renderNode.lastResult;
    this.clearRenderedViews(view.env);
  };

Renderer.prototype.renderTopLevelView =
  function Renderer_renderTopLevelView(view, renderNode) {
    // Check to see if insertion has been canceled
    if (view._willInsert) {
      view._willInsert = false;
      this.prerenderTopLevelView(view, renderNode);
      this.dispatchLifecycleHooks(view.env);
    }
  };

Renderer.prototype.revalidateTopLevelView =
  function Renderer_revalidateTopLevelView(view) {
    // This guard prevents revalidation on an already-destroyed view.
    if (view._renderNode.lastResult) {
      view._renderNode.lastResult.revalidate(view.env);
      // supports createElement, which operates without moving the view into
      // the inDOM state.
      if (view._state === 'inDOM') {
        this.dispatchLifecycleHooks(view.env);
      }
      this.clearRenderedViews(view.env);
    }
  };

Renderer.prototype.dispatchLifecycleHooks =
  function Renderer_dispatchLifecycleHooks(env) {
    var ownerView = env.view;

    var lifecycleHooks = env.lifecycleHooks;
    var i, hook;

    for (i=0; i<lifecycleHooks.length; i++) {
      hook = lifecycleHooks[i];
      ownerView._dispatching = hook.type;

      switch (hook.type) {
        case 'didInsertElement': this.didInsertElement(hook.view); break;
        case 'didUpdate': this.didUpdate(hook.view); break;
      }

      this.didRender(hook.view);
    }

    ownerView._dispatching = null;
    env.lifecycleHooks.length = 0;
  };

Renderer.prototype.ensureViewNotRendering =
  function Renderer_ensureViewNotRendering(view) {
    var env = view.ownerView.env;
    if (env && indexOf(env.renderedViews, view.elementId) !== -1) {
      throw new Error('Something you did caused a view to re-render after it rendered but before it was inserted into the DOM.');
    }
  };

Renderer.prototype.clearRenderedViews =
  function Renderer_clearRenderedViews(env) {
    env.renderedViews.length = 0;
  };

// This entry point is called from top-level `view.appendTo`
Renderer.prototype.appendTo =
  function Renderer_appendTo(view, target) {
    var morph = this._dom.appendMorph(target);
    morph.ownerNode = morph;
    view._willInsert = true;
    run.scheduleOnce('render', this, this.renderTopLevelView, view, morph);
  };

Renderer.prototype.replaceIn =
  function Renderer_replaceIn(view, target) {
    var morph = this._dom.replaceContentWithMorph(target);
    morph.ownerNode = morph;
    view._willInsert = true;
    run.scheduleOnce('render', this, this.renderTopLevelView, view, morph);
  };

Renderer.prototype.createElement =
  function Renderer_createElement(view) {
    var morph = this._dom.createFragmentMorph();
    morph.ownerNode = morph;
    this.prerenderTopLevelView(view, morph);
  };

Renderer.prototype.willCreateElement = function (view) {
  if (subscribers.length && view.instrumentDetails) {
    view._instrumentEnd = _instrumentStart('render.'+view.instrumentName, function viewInstrumentDetails() {
      var details = {};
      view.instrumentDetails(details);
      return details;
    });
  }
}; // inBuffer

Renderer.prototype.didCreateElement = function (view, element) {
  if (element) {
    view.element = element;
  }

  if (view._transitionTo) {
    view._transitionTo('hasElement');
  }
  if (view._instrumentEnd) {
    view._instrumentEnd();
  }
}; // hasElement

Renderer.prototype.willInsertElement = function (view) {
  if (view.trigger) { view.trigger('willInsertElement'); }
}; // will place into DOM

Renderer.prototype.setAttrs = function (view, attrs) {
  set(view, 'attrs', attrs);
}; // set attrs the first time

Renderer.prototype.didInsertElement = function (view) {
  if (view._transitionTo) {
    view._transitionTo('inDOM');
  }

  if (view.trigger) { view.trigger('didInsertElement'); }
}; // inDOM // placed into DOM

Renderer.prototype.didUpdate = function (view) {
  if (view.trigger) { view.trigger('didUpdate'); }
};

Renderer.prototype.didRender = function (view) {
  if (view.trigger) { view.trigger('didRender'); }
};

Renderer.prototype.updateAttrs = function (view, attrs) {
  if (view.willReceiveAttrs) {
    view.willReceiveAttrs(attrs);
  }

  this.setAttrs(view, attrs);
}; // setting new attrs

Renderer.prototype.willUpdate = function (view, attrs) {
  if (view.willUpdate) {
    view.willUpdate(attrs);
  }
};

Renderer.prototype.willRender = function (view) {
  if (view.willRender) {
    view.willRender();
  }
};

Renderer.prototype.remove = function (view, shouldDestroy) {
  this.willDestroyElement(view);

  view._willRemoveElement = true;
  run.schedule('render', this, this.renderElementRemoval, view);
};

Renderer.prototype.renderElementRemoval =
  function Renderer_renderElementRemoval(view) {
    // Use the _willRemoveElement flag to avoid mulitple removal attempts in
    // case many have been scheduled. This should be more performant than using
    // `scheduleOnce`.
    if (view._willRemoveElement) {
      view._willRemoveElement = false;

      if (view._renderNode) {
        view._renderNode.clear();
      }
      this.didDestroyElement(view);
    }
  };

Renderer.prototype.willRemoveElement = function (view) {};

Renderer.prototype.willDestroyElement = function (view) {
  if (view._willDestroyElement) {
    view._willDestroyElement();
  }
  if (view.trigger) {
    view.trigger('willDestroyElement');
    view.trigger('willClearRender');
  }

  view._transitionTo('destroying', false);

  var childViews = view.childViews;
  if (childViews) {
    for (var i = 0; i < childViews.length; i++) {
      this.willDestroyElement(childViews[i]);
    }
  }
};

Renderer.prototype.didDestroyElement = function (view) {
  view.element = null;

  // Views that are being destroyed should never go back to the preRender state.
  // However if we're just destroying an element on a view (as is the case when
  // using View#remove) then the view should go to a preRender state so that
  // it can be rendered again later.
  if (view._state !== 'destroying') {
    view._transitionTo('preRender');
  }

  var childViews = view.childViews;
  if (childViews) {
    for (var i = 0; i < childViews.length; i++) {
      this.didDestroyElement(childViews[i]);
    }
  }
}; // element destroyed so view.destroy shouldn't try to remove it removedFromDOM

export default Renderer;
