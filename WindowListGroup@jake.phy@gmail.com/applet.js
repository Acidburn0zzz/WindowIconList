//vim: expandtab shiftwidth=4 tabstop=8 softtabstop=4 encoding=utf-8 textwidth=99
/* -*- mode: js2; js2-basic-offset: 4; indent-tabs-mode: nil -*- */
// Cinnamon Window List
// Authors:
//   Kurt Rottmann <kurtrottmann@gmail.com>
//   Jason Siefken
//   Josh hess <jake.phy@gmail.com>
// Taking code from
// Copyright (C) 2011 R M Yorston
// Licence: GPLv2+
// http://intgat.tigress.co.uk/rmy/extensions/gnome-Cinnamon-frippery-0.2.3.tgz
/* jshint moz:true */
const Applet = imports.ui.applet;
const Clutter = imports.gi.Clutter;
const Lang = imports.lang;
const Cinnamon = imports.gi.Cinnamon;
const St = imports.gi.St;
const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Tweener = imports.ui.tweener;
const Meta = imports.gi.Meta;
const PopupMenu = imports.ui.popupMenu;
const Signals = imports.signals;
const DND = imports.ui.dnd;
const AppFavorites = imports.ui.appFavorites;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Gio = imports.gi.Gio;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;

const SPINNER_ANIMATION_TIME = 1;

function _(str) {
   let resultConf = Gettext.dgettext('WindowListGroup@jake.phy@gmail.com', str);
   if(resultConf != str) {
      return resultConf;
   }
   return Gettext.gettext(str);
}


// Load our applet so we can access other files in our extensions dir as libraries
const AppletDir = imports.ui.appletManager.applets['WindowListGroup@jake.phy@gmail.com'];
const SpecialMenus = AppletDir.specialMenus;
const SpecialButtons = AppletDir.specialButtons;

const TitleDisplay = {
    none: 1,
    app: 2,
    title: 3,
    focused: 4
};
const NumberDisplay = {
    smart: 1,
    normal: 2,
    none: 3,
    all: 4
};
const SortThumbs = {
    focused: 1,
    opened: 2
};

// Some functional programming tools
const dir = function (obj) {
    let props = [afor(a in obj)];
    props.concat(Object.getOwnPropertyNames(obj));
    return props;
};

const range = function (a, b) {
    let ret = [];
        // if b is unset, we want a to be the upper bound on the range
    if (b === null || b === undefined) {
        [a, b] = [0, a];
    }

    for (let i = a; i < b; i++) {
        ret.push(i);
    }
    return ret;
};

const zip = function (a, b) {
    let ret = [];
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        ret.push([a[i], b[i]]);
    }
    return ret;
};

const unzip = function (a) {
    let ret1 = [],
        ret2 = [];
    a.forEach(function (tuple) {
        ret1.push(tuple[0]);
        ret2.push(tuple[1]);
    });

    return [ret1, ret2];
};

// Connects and keeps track of signal IDs so that signals
// can be easily disconnected

function SignalTracker() {
    this._init.apply(this, arguments);
}

SignalTracker.prototype = {
    _init: function () {
        this._data = [];
    },

    // params = {
    //              signalName: Signal Name
    //              callback: Callback Function
    //              bind: Context to bind to
    //              object: object to connect to
    //}
    connect: function (params) {
        let signalName = params.signalName;
        let callback = params.callback;
        let bind = params.bind;
        let object = params.object;
        let signalID = null;

        signalID = object.connect(signalName, Lang.bind(bind, callback));
        this._data.push({
            signalName: signalName,
            callback: callback,
            object: object,
            signalID: signalID,
            bind: bind
        });
    },

    disconnect: function (param) {

    },

    disconnectAll: function () {
        this._data.forEach(function (data) {
            data.object.disconnect(data.signalID);
            for (let prop in data) {
                data[prop] = null;
            }
        });
        this._data = [];
    }
};


function PinnedFavs() {
    this._init.apply(this, arguments);
}

PinnedFavs.prototype = {

    _init: function (applet) {
        this._applet = applet;
        this._favorites = {};
        this._applet.settings.connect('changed::pinned-apps', Lang.bind(this, function() { this._onFavsChanged(); } ));
        this._reload();
    },

    _onFavsChanged: function () {
        if(this._reload())
            this.emit('changed');
    },

    _reload: function () {
        let ids = this._applet.settings.getValue("pinned-apps");
        let appSys = Cinnamon.AppSystem.get_default();
        let apps = ids.map(function (id) {
            let app = appSys.lookup_app(id);
            return app;
        }).filter(function (app) {
            return app !== undefined && app !== null;
        });
        let needReaload = false;
        let keys = Object.keys(this._favorites);

        for (let i = 0; i < apps.length; i++) {
            let app = apps[i];
            let id = app.get_id();
            if(!this._favorites[id]) {
                this._favorites[id] = app;
                needReaload = true;
            } else {
                let index = keys.indexOf(id);
                if(index != -1)
                    keys.splice(index, 1);
            }
        }
        if(keys.length > 0) {
            needReaload = true;
            for (let i = 0; i < keys.length; i++) {
                let key = keys[i];
                if(keys in this._favorites)
                    delete this._favorites[key];
            }
        }
        return needReaload;
    },

    _getIds: function () {
        let ret = [];
        for (let id in this._favorites)
            ret.push(id);
        return ret;
    },

    getFavoriteMap: function () {
        return this._favorites;
    },

    getFavorites: function () {
        let ret = [];
        for (let id in this._favorites)
            ret.push(this._favorites[id]);
        return ret;
    },

    isFavorite: function (appId) {
        return appId in this._favorites;
    },

    _addFavorite: function (appId, pos) {
        if (appId in this._favorites)
            return false;

        let app = Cinnamon.AppSystem.get_default().lookup_app(appId);
        if (!app) app = Cinnamon.AppSystem.get_default().lookup_settings_app(appId);

        if (!app)
            return false;

        let ids = this._getIds();
        if (pos == -1)
            ids.push(appId);
        else
            ids.splice(pos, 0, appId);
        this._applet.settings.setValue("pinned-apps", ids);
        this._onFavsChanged();
        return true;
    },

    addFavoriteAtPos: function (appId, pos) {
        this._addFavorite(appId, pos);
    },

    addFavorite: function (appId) {
        this.addFavoriteAtPos(appId, -1);
    },

    moveFavoriteToPos: function (appId, pos) {
        let ids = this._getIds();
        let old_index = ids.indexOf(appId);
        if (pos > old_index)
            pos = pos - 1;
        ids.splice(pos, 0, ids.splice(old_index, 1)[0]);
        this._applet.settings.setValue("pinned-apps", ids);
    },

    _removeFavorite: function (appId) {
        if (!appId in this._favorites)
            return false;

        let ids = this._getIds().filter(function (id) {
            return id != appId;
        });
        this._applet.settings.setValue("pinned-apps", ids);
        this._onFavsChanged();
        return true;
    },

    removeFavorite: function (appId) {
        this._removeFavorite(appId);
    }
};
Signals.addSignalMethods(PinnedFavs.prototype);

// AppGroup is a container that keeps track
// of all windows of @app (all windows on workspaces
// that are watched, that is).

var __proto = Object //This is needed to support the old cinnamon implementation
if(DND.LauncherDraggable)
    __proto = DND.LauncherDraggable;

function AppGroup() {
    this._init.apply(this, arguments);
}

AppGroup.prototype = {
    __proto__: __proto.prototype,
    _init: function (applet, appList, app, isFavapp, orientation) {
        if(DND.LauncherDraggable)
            DND.LauncherDraggable.prototype._init.call(this);
        this._applet = applet;
        this.appList = appList;
        this.launchersBox = applet; //This convert the applet class in a launcherBox(is requiere to be a launcher dragable object)
                                    //but you have duplicate object this._applet then...
        this.app = app;
        this.isFavapp = isFavapp;
        this.isNotFavapp = !isFavapp;
        this.orientation = orientation;
        this.metaWindows = {};
        this.metaWorkspaces = {};
        this.actor = new St.Bin({
            reactive: true,
            can_focus: true,
            x_fill: true,
            y_fill: false,
            track_hover: true
        });
        this.actor._delegate = this;

        this.myactor = new St.BoxLayout({
            reactive: true
        });
        this.actor.set_child(this.myactor);

        this._windowButtonBox = new SpecialButtons.ButtonBox();
        this._appButton = new SpecialButtons.AppButton(this);

        this.myactor.add(this._appButton.actor);
        this.myactor.add(this._windowButtonBox.actor);

        this._appButton.actor.connect('button-release-event', Lang.bind(this, this._onAppButtonRelease));
        //global.screen.connect('event', Lang.bind(this, this._onAppKeyPress));
        //        global.screen.connect('key-release-event', Lang.bind(this, this._onAppKeyReleased));
        // Set up the right click menu for this._appButton
        this.rightClickMenu = new SpecialMenus.AppMenuButtonRightClickMenu(this, this._appButton.actor);
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menuManager.addMenu(this.rightClickMenu);

        // Set up the hover menu for this._appButton
        this.hoverMenu = new SpecialMenus.AppThumbnailHoverMenu(this);
        this._hoverMenuManager = new SpecialMenus.HoverMenuController(this);
        this._hoverMenuManager.addMenu(this.hoverMenu);

        this._draggable = SpecialButtons.makeDraggable(this.actor);
        this._draggable.connect('drag-cancelled', Lang.bind(this, this._onDragCancelled));
        this._draggable.connect('drag-end', Lang.bind(this, this._onDragEnd));
        this.isDraggableApp = true;

        this.on_panel_edit_mode_changed();
        this.on_arrange_pinned();
        global.settings.connect('changed::panel-edit-mode', Lang.bind(this, this.on_panel_edit_mode_changed));
        this._applet.settings.connect("arrange-pinnedApps", Lang.bind(this, this.on_arrange_pinned));
    },

    getId: function() {
        return this.app.get_id();
    },

    on_arrange_pinned: function () {
        this._draggable.inhibit = !this._applet.settings.getValue("arrange-pinnedApps");
    },

    on_panel_edit_mode_changed: function () {
        this._draggable.inhibit = global.settings.get_boolean("panel-edit-mode");
        this.actor.reactive = !global.settings.get_boolean("panel-edit-mode");
    },

    _onDragEnd: function () {
        this.rightClickMenu.close(false);
        this.hoverMenu.close(false);
        this.appList.myactorbox._clearDragPlaceholder();
    },

    _onDragCancelled: function () {
        this.rightClickMenu.close(false);
        this.hoverMenu.close(false);
        this.appList.myactorbox._clearDragPlaceholder();
    },

    handleDragOver: function (source, actor, x, y, time) {
        if (source instanceof AppGroup || source.isDraggableApp || (source instanceof DND.LauncherDraggable)) return DND.DragMotionResult.CONTINUE;

        if (typeof (this.appList.dragEnterTime) == 'undefined') {
            this.appList.dragEnterTime = time;
        } else {
            if (time > (this.appList.dragEnterTime + 3000)) {
                this.appList.dragEnterTime = time;
            }
        }

        if (time > (this.appList.dragEnterTime + 300) && !(this.isFavapp || source.isDraggableApp) && this._applet.settings.getValue("group-apps")) {
            this._windowHandle(true);
        }
        return true;
    },

    getDragActor: function () {
        return this.app.create_icon_texture(this._applet._panelHeight);
    },

    // Returns the original actor that should align with the actor
    // we show as the item is being dragged.
    getDragActorSource: function () {
        return this.actor;
    },

    // Add a workspace to the list of workspaces that are watched for
    // windows being added and removed
    watchWorkspace: function (metaWorkspace) {
        if (!this.metaWorkspaces[metaWorkspace]) {
            // We use connect_after so that the window-tracker time to identify the app, otherwise get_window_app might return null!
            let windowAddedSignal = metaWorkspace.connect_after('window-added', Lang.bind(this, this._windowAdded));
            let windowRemovedSignal = metaWorkspace.connect_after('window-removed', Lang.bind(this, this._windowRemoved));
            this.metaWorkspaces[metaWorkspace] = {
                workspace: metaWorkspace,
                signals: [windowAddedSignal, windowRemovedSignal]
            };
        }
        this._calcWindowNumber(metaWorkspace);
        this._applet.settings.connect("changed::number-display", Lang.bind(this, function () {
            this._calcWindowNumber(metaWorkspace);
        }));
    },

    // Stop monitoring a workspace for added and removed windows.
    // @metaWorkspace: if null, will remove all signals
    unwatchWorkspace: function (metaWorkspace) {
        function removeSignals(obj) {
            let signals = obj.signals;
            for(let i = 0; i < signals.length; i++) {
                obj.workspace.disconnect(signals[i]);
            }
        }

        if (!metaWorkspace) {
            for(let k in this.metaWorkspaces) {
                removeSignals(this.metaWorkspaces[k]);
                delete this.metaWorkspaces[k];
            }
        } else if (this.metaWorkspaces[metaWorkspace]) {
            removeSignals(this.metaWorkspaces[metaWorkspace]);
            delete this.metaWorkspaces[metaWorkspace];
        } else {
            global.log('Warning: tried to remove watch on an unwatched workspace');
        }
    },

    hideWindowButtons: function () {
        this._windowButtonBox.actor.hide();
    },

    showWindowButtons: function () {
        this._windowButtonBox.actor.show();
    },

    hideAppButton: function () {
        this._appButton.actor.hide();
    },

    showAppButton: function () {
        this._appButton.actor.show();
    },

    hideAppButtonLabel: function (animate) {
        this._appButton.hideLabel(animate);
    },

    showAppButtonLabel: function (animate, targetWidth) {
        this._appButton.showLabel(animate, targetWidth);
    },

    _onAppButtonRelease: function (actor, event) {
        if (event.get_state() & Clutter.ModifierType.BUTTON1_MASK && this.isFavapp || event.get_state() & Clutter.ModifierType.SHIFT_MASK && event.get_state() & Clutter.ModifierType.BUTTON1_MASK) {
            this.app.open_new_window(-1);
            this._animate();
            return;
        }

        let windowNum = this.app.get_windows().filter(function (win) {
            let workspaces = [global.screen.get_workspace_by_index(i) for each(i in range(global.screen.n_workspaces))];
            for (let i = 0; i < workspaces.length; i++) {
                if (win.get_workspace() == workspaces[i])
                    return workspaces[i];
            }
            return false;
        }).length;

        if (!this.lastFocused) return;

        if (event.get_state() & Clutter.ModifierType.BUTTON2_MASK && !this.isFavapp) {
            this.app.open_new_window(-1);

        } else if (event.get_state() & Clutter.ModifierType.BUTTON1_MASK) {
            if (this._applet.onclickThumbs && windowNum > 1) {
                this.hoverMenu.shouldOpen = true;
                this.hoverMenu.shouldClose = false;
                this.hoverMenu.hoverOpen();
            } else
                this._windowHandle(false);

        }

    },

    _newAppKeyNumber: function (number) {   
        if(this.hotKeyId)
            Main.keybindingManager.removeHotKey(this.hotKeyId);
        if (number < 10){
            Main.keybindingManager.addHotKey('launch-app-key-' + number.toString(), "<Super>" + number.toString(), Lang.bind(this, this._onAppKeyPress));
            this.hotKeyId = 'launch-app-key-' + number.toString();
        }
    },

    _onAppKeyPress: function () {
        if (this.isFavapp) {
            this.app.open_new_window(-1);
            this._animate();
        } else {
            this._windowHandle(false);
        }
    },

    _windowHandle: function(fromDrag){
        let has_focus = this.lastFocused.has_focus();
        if (!this.lastFocused.minimized && !has_focus) {
            this.lastFocused.foreach_transient(function(child) {
                if (!child.minimized && child.has_focus()) {
                    has_focus = true;
                }
            });
        }
        if ( has_focus ) {
            if (fromDrag){
                return;
            }
            this.lastFocused.minimize(global.get_current_time());
            this.actor.remove_style_pseudo_class('focus');
        }
        else {
            if (this.lastFocused.minimized) {
                this.lastFocused.unminimize(global.get_current_time()); 
            }
            let ws = this.lastFocused.get_workspace().index();
            if (ws != global.screen.get_active_workspace_index()) {
                global.screen.get_workspace_by_index(ws).activate(global.get_current_time());
            }
            Main.activateWindow(this.lastFocused, global.get_current_time());
            this.actor.add_style_pseudo_class('focus');
            //this._removeAlerts(this.metaWindow);
        }
    },
    _getLastFocusedWindow: function () {
        // Get a list of windows and sort it in order of last access
        let list = [];
        for(let win in this.metaWindows){
            list.push([ this.metaWindows[win].win.user_time,  this.metaWindows[win].win] );
        }
        list.sort(function (a, b) {
            return a[0] - b[0];
        });
        log(list[0]);
        if (list[0]) return list[0][1];
        else return null;
    },

    // updates the internal list of metaWindows
    // to include all windows corresponding to this.app on the workspace
    // metaWorkspace
    _updateMetaWindows: function (metaWorkspace) {
        let tracker = Cinnamon.WindowTracker.get_default();
        // Get a list of all interesting windows that are part of this app on the current workspace
        let windowList = metaWorkspace.list_windows().filter(Lang.bind(this, function (metaWindow) {
            try {
                return tracker.get_window_app(metaWindow) == this.app && tracker.is_window_interesting(metaWindow) && Main.isInteresting(metaWindow);
            } catch (e) {
                log(e.name + ': ' + e.message);
                return false;
            }
        }));
        this.metaWindows = {};
        this._windowButtonBox.clear();
        this._loadWinBoxFavs();
        windowList.forEach(Lang.bind(this, function (win) {
            this._windowAdded(metaWorkspace, win);
        }));

        // When we first populate we need to decide which window
        // will be triggered when the app button is pressed
        if (!this.lastFocused) {
            this.lastFocused = this._getLastFocusedWindow();
        }
        if (this.lastFocused) {
            this._windowTitleChanged(this.lastFocused);
            this.rightClickMenu.setMetaWindow(this.lastFocused);
        }
    },

    _windowAdded: function (metaWorkspace, metaWindow) {
        let tracker = Cinnamon.WindowTracker.get_default();
        if (tracker.get_window_app(metaWindow) == this.app && !this.metaWindows[metaWindow] && tracker.is_window_interesting(metaWindow)) {
            let button = null;
            if(this._applet.groupApps === false){
                button = new SpecialButtons.WindowButton({
                    parent: this,
                    isFavapp: false,
                    metaWindow: metaWindow,
                });
                this._windowButtonBox.add(button);
            }
            if (metaWindow) {
                this.lastFocused = metaWindow;
                this.rightClickMenu.setMetaWindow(this.lastFocused);
                this.hoverMenu.setMetaWindow(this.lastFocused);
            }
            let signals = [];
            this._applet.settings.connect("changed::title-display", Lang.bind(this, function(){
                this._windowTitleChanged(this.lastFocused);
            }));
            signals.push(metaWindow.connect('notify::title', Lang.bind(this, this._windowTitleChanged)));
            signals.push(metaWindow.connect('notify::appears-focused', Lang.bind(this, this._focusWindowChange)));
            let data = {
                signals: signals,
                windowButton: button
            };
            this.metaWindows[metaWindow] = {win: metaWindow, data: data};
            if (this.isFavapp) {
                this._isFavorite(false);
            }
            this._calcWindowNumber(metaWorkspace);
        }
    },

    _windowRemoved: function (metaWorkspace, metaWindow) {
        let deleted;
        if(this.metaWindows[metaWindow])
            deleted = this.metaWindows[metaWindow].data;
        if (deleted) {
            let signals = deleted.signals;
            let button = deleted.windowButton;
            // Clean up all the signals we've connected
            for(let i = 0; i < signals.length; i++) {
                metaWindow.disconnect(signals[i]);
            }
            if(button){
                this._windowButtonBox.remove(button);
                button.destroy();
            }   
            delete this.metaWindows[metaWindow];

            // Make sure we don't leave our appButton hanging!
            // That is, we should no longer display the old app in our title
            let nextWindow;
            for(let i in this.metaWindows){
                nextWindow = this.metaWindows[i].win;
                break;
            }
            if (nextWindow) {
                this.lastFocused = nextWindow;
                this._windowTitleChanged(this.lastFocused);
                this.hoverMenu.setMetaWindow(this.lastFocused);
                this.rightClickMenu.setMetaWindow(this.lastFocused);
            }
            this._calcWindowNumber(metaWorkspace);
        }
    },

    _windowTitleChanged: function (metaWindow) {
        // We only really want to track title changes of the last focused app
        if (!this._appButton) {
            throw 'Error: got a _windowTitleChanged callback but this._appButton is undefined';
        }
        if (metaWindow != this.lastFocused || this.isFavapp) return;

        let titleType = this._applet.settings.getValue("title-display");
        let [title, appName] = [metaWindow.get_title(), this.app.get_name()];
        if (titleType == TitleDisplay.title) {
            if (title) {
                this._appButton.setText(title);
            }
        } else if (titleType == TitleDisplay.focused) {
            if (title) {
                this._appButton.setText(title);
                this._updateFocusedStatus(true);
            }
        } else if (titleType == TitleDisplay.app) {
            if (appName) {
                this._appButton.setText(appName);
            }
        } else if (titleType == TitleDisplay.none) {
            this._appButton.setText("");
        }
    },

    _focusWindowChange: function (metaWindow) {
        if (metaWindow.appears_focused) {
            this.lastFocused = metaWindow;
            this._windowTitleChanged(this.lastFocused);
            //if (this._applet.sortThumbs == SortThumbs.focused) this.hoverMenu.setMetaWindow(this.lastFocused);
            this.rightClickMenu.setMetaWindow(this.lastFocused);
        }
        if (this._applet.settings.getValue("title-display") == TitleDisplay.focused)
            this._updateFocusedStatus();
    },

    _updateFocusedStatus: function (force) {
        let changed = false;
        let focusState = this.metaWindows.keys().some(function (win, data) {
            return win.appears_focused;
        });
        if (this.focusState != focusState || force)
            this._focusedLabel(focusState);
        this.focusState = focusState;
    },

    _focusedLabel: function (focusState) {
        if (focusState) {
            this.showAppButtonLabel(true, 150);
        } else {
            this.hideAppButtonLabel(true);
        }
    },

    _loadWinBoxFavs: function () {
        if (this._applet.groupApps === false && this.isFavapp || this.wasFavapp ) {
            let button = new SpecialButtons.WindowButton({
                parent: this,
                isFavapp: true,
                metaWindow: null,
            });
            this._windowButtonBox.add(button);
        }
    },

    _isFavorite: function (isFav) {
        this.isFavapp = isFav;
        this.wasFavapp = !(isFav);
        this._appButton._isFavorite(isFav);
        this.rightClickMenu.removeItems();
        this.rightClickMenu._isFavorite(isFav);
        this.hoverMenu.appSwitcherItem._isFavorite(isFav);
        this._windowTitleChanged(this.lastFocused);
    },

    _calcWindowNumber: function (metaWorkspace) {
        if (!this._appButton) {
            throw 'Error: got a _calcWindowNumber callback but this._appButton is undefined';
        }

        let windowNum = this.app.get_windows().filter(function (win) {
            return win.get_workspace() == metaWorkspace && Main.isInteresting(win);
        }).length;
        let numDisplay = this._applet.settings.getValue("number-display");
        this._appButton._numLabel.text = windowNum.toString();
        if (numDisplay == NumberDisplay.smart) {
            if (windowNum <= 1)
                this._appButton._numLabel.hide();
            else
                this._appButton._numLabel.show();
        } else if (numDisplay == NumberDisplay.normal) {
            if (windowNum <= 0)
                this._appButton._numLabel.hide();
            else
                this._appButton._numLabel.show();
        } else if (numDisplay == NumberDisplay.all) {
            this._appButton._numLabel.show();
        } else {
            this._appButton._numLabel.hide();
        }
    },

    _animate: function () {
        this.actor.set_z_rotation_from_gravity(0.0, Clutter.Gravity.CENTER);
        Tweener.addTween(this.actor, {
            opacity: 70,
            time: 1.0,
            transition: "linear",
            onCompleteScope: this,
            onComplete: function () {
                Tweener.addTween(this.actor, {
                    opacity: 255,
                    time: 0.5,
                    transition: "linear"
                });
            }
        });
    },

    destroy: function () {
        // Unwatch all workspaces before we destroy all our actors
        // that callbacks depend on

        for(let i in this.metaWindows){
            let metaWindow = this.metaWindows[i];
            metaWindow.data.signals.forEach(function(s) {
                metaWindow.win.disconnect(s);
            });
        }
        this.unwatchWorkspace(null);
        this.rightClickMenu.destroy();
        this.hoverMenu.destroy();
        this._appButton.destroy();
        this._windowButtonBox.destroy();
        this.myactor.destroy();
        this.actor.destroy();
        /*this._appButton = null;
        this._windowButtonBox = null;
        this.actor = null;
        this.rightClickMenu = null;
        this.hoverMenu = null;*/
    }
};
Signals.addSignalMethods(AppGroup.prototype);

// List of running apps

function AppList() {
    this._init.apply(this, arguments);
}

AppList.prototype = {
    _init: function (applet, metaWorkspace, orientation) {
        this.orientation = orientation;
        this._applet = applet;
        this.myactorbox = new SpecialButtons.MyAppletBox(this._applet);
        this.actor = this.myactorbox.actor;

        if (orientation == St.Side.TOP) {
            this.actor.add_style_class_name('window-list-box-top');
            this.actor.style = 'margin-top: 0px; padding-top: 0px;';
            //this.actor.set_style('padding-left: 3px');
        } else {
            this.actor.add_style_class_name('window-list-box-bottom');
            this.actor.style = 'margin-bottom: 0px; padding-bottom: 0px;';
            //this.actor.set_style('padding-left: 3px');
        }

        this.metaWorkspace = metaWorkspace;
        this._appList = {};
        // We need a backup database of the associated app for each metaWindow since something get_window_app will return null
        this._tracker = Cinnamon.WindowTracker.get_default();
        // Connect all the signals
        this._setSignals();
        this._refreshList();
    },

    on_panel_edit_mode_changed: function () {
        this.actor.reactive = global.settings.get_boolean("panel-edit-mode");
    },

    _setSignals: function () {
        this.signals = [];
        // We use connect_after so that the window-tracker time to identify the app
        this.signals.push(this.metaWorkspace.connect_after('window-added', Lang.bind(this, this._windowAdded)));
        this.signals.push(this.metaWorkspace.connect_after('window-removed', Lang.bind(this, this._windowRemoved)));
        this._applet.pinned_app_contr().connect("changed", Lang.bind(this, this._refreshList));
        this._applet.settings.connect("changed::group-apps", Lang.bind(this, this._refreshList));
        this._applet.settings.connect("changed::show-pinned", Lang.bind(this, this._refreshList));
        global.settings.connect("changed::panel-edit-mode", Lang.bind(this, this.on_panel_edit_mode_changed));
    },

    // Gets a list of every app on the current workspace
    _refreshApps: function () {
        // For each window, let's make sure we add it!
        this.metaWorkspace.list_windows().forEach(Lang.bind(this, function (win) {
            this._windowAdded(this.metaWorkspace, win);
        }));
    },

    _refreshList: function () {
        for(let i in this._appList) {
            let list = this._appList[i];
            list.appGroup.destroy();
        }
        this._appList = {};
        this._loadFavorites();
        this._refreshApps();
    },

    _appGroupNumber: function (parentApp) {
        let i = 0;
        for(let l in this._appList) {
            let list = this._appList[l];
            ++i;
            if (list.appGroup.app == parentApp)
                break;
        }
        return i;
    },

    _refreshAppGroupNumber: function () {
        let i = 0;
        for(let l in this._appList) {
            let list = this._appList[l];
            i = i + 1;
            list.appGroup._newAppKeyNumber(i);
        }
    },

    _windowAdded: function (metaWorkspace, metaWindow, favapp, isFavapp) {
        // Check to see if the window that was added already has an app group.
        // If it does, then we don't need to do anything.  If not, we need to
        // create an app group.
        //let tracker = Cinnamon.WindowTracker.get_default();
        let tracker = this._tracker;
        let app;
        if (favapp) app = favapp;
        else app = tracker.get_window_app(metaWindow);
        if(!app) return;
        if (!this._appList[app]) {
            let appGroup = new AppGroup(this._applet, this, app, isFavapp, this.orientation);
            appGroup._updateMetaWindows(metaWorkspace);
            appGroup.watchWorkspace(metaWorkspace);
            if (this._applet.settings.getValue("group-apps")) {
                appGroup.hideWindowButtons();
            } else {
                appGroup.hideAppButton();
            }
            this.actor.add_actor(appGroup.actor);

            // We also need to monitor the state 'cause some pesky apps (namely: plugin_container left over after fullscreening a flash video)
            // don't report having zero windows after they close
            app.connect('notify::state', Lang.bind(this, function (app) {
                if (app.state == Cinnamon.AppState.STOPPED && this._appList[app]) {
                    this._removeApp(app);
                    appGroup._calcWindowNumber(metaWorkspace);
                }
            }));

            this._appList[app] = {
                appGroup: appGroup,
            };
            let appGroupNum = this._appGroupNumber(app);
            appGroup._newAppKeyNumber(appGroupNum);

            if (this._applet.settings.getValue("title-display") == TitleDisplay.focused)
                appGroup.hideAppButtonLabel(false);
        }
    },

    _removeApp: function (app) {
        // This function may get called multiple times on the same app and so the app may have already been removed
        let appGroup = this._appList[app];
        if (appGroup) {
            if (appGroup.appGroup.wasFavapp || appGroup.appGroup.isFavapp) {
                appGroup.appGroup._isFavorite(true);
                // have to delay to fix openoffice start-center bug 
                Mainloop.timeout_add(0, Lang.bind(this, this._refreshApps));
                return;
            }
            delete this._appList[app];
            appGroup.appGroup.destroy();
            Mainloop.timeout_add(15, Lang.bind(this, function () {
                this._refreshApps();
                this._refreshAppGroupNumber();
            }));
        }

    },

    _loadFavorites: function () {
        if (!this._applet.settings.getValue("show-pinned")) return;
        let launchers = this._applet.settings.getValue("pinned-apps"),
            appSys = Cinnamon.AppSystem.get_default();
        for (let i = 0; i < launchers.length; ++i) {
            let app = appSys.lookup_app(launchers[i]);
            if (!app) app = appSys.lookup_settings_app(launchers[i]);
            if (!app) continue;
            this._windowAdded(this.metaWorkspace, null, app, true);
        }
    },

    _windowRemoved: function (metaWorkspace, metaWindow) {
        // When a window is closed, we need to check if the app it belongs
        // to has no windows left.  If so, we need to remove the corresponding AppGroup
        //let tracker = Cinnamon.WindowTracker.get_default();
        let tracker = this._tracker;
        let app = tracker.get_window_app(metaWindow);
        if(!app) return;

        let hasWindowsOnWorkspace = app.get_windows().some(function (win) {
            return win.get_workspace() == metaWorkspace;
        });
        if (app && !hasWindowsOnWorkspace) {
            this._removeApp(app);
        }
    },

    destroy: function () {
        this.signals.forEach(Lang.bind(this, function (s) {
            this.metaWorkspace.disconnect(s);
        }));
        for(let i in this._appList) {
            this._appList[i].appGroup.destroy();
        }
        this._appList.destroy();
        this._appList = null;
    }
};

// Manages window/app lists and takes care of
// hiding/showing them and manages switching workspaces, etc.

function MyApplet(metadata, orientation, panel_height, instance_id) {
    this._init(metadata, orientation, panel_height, instance_id);
}

MyApplet.prototype = {
    __proto__: Applet.Applet.prototype,

    _init: function (metadata, orientation, panel_height, instance_id) {
        Applet.Applet.prototype._init.call(this, orientation, panel_height, instance_id);
        try {
            this._uuid = metadata.uuid;
            //this.execInstallLanguage();
            Gettext.bindtextdomain(this._uuid, GLib.get_home_dir() + "/.local/share/locale");
            this.settings = new Settings.AppletSettings(this, "WindowListGroup@jake.phy@gmail.com", instance_id);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "group-apps", "groupApps", null, null);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-pinned", "showPinned", null, null);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "arrange-pinnedApps", "arrangePinned", null, null);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "enable-hover-peek", "enablePeek", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "onclick-thumbnails", "onclickThumbs", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "hover-peek-opacity", "peekOpacity", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "thumbnail-timeout", "thumbTimeout", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "thumbnail-size", "thumbSize", null, null);
            //this.settings.bindProperty(Settings.BindingDirection.IN, "sort-thumbnails", "sortThumbs", null, null);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "vertical-thumbnails", "verticalThumbs", null, null);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "stack-thumbnails", "stackThumbs", null, null);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-thumbnails", "showThumbs", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "number-display", "numDisplay", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "title-display", "titleDisplay", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "icon-padding", "iconPadding", null, null);
            //this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "pinned-apps", "pinnedApps", null, null);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "pinned-recent", "pinnedRecent", null, null);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "show-recent", "showRecent", null, null);
            this.settings.bindProperty(Settings.BindingDirection.BIDIRECTIONAL, "appmenu-width", "appMenuWidth", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "firefox-menu", "firefoxMenu", null, null);
            this.settings.bindProperty(Settings.BindingDirection.IN, "appmenu-number", "appMenuNum", null, null);
            this.orientation = orientation;
            this.dragInProgress = false;

            this._box = new St.Bin();

            this.actor.add(this._box);
            this.actor.reactive = global.settings.get_boolean("panel-edit-mode");


            if (orientation == St.Side.TOP) {
                this.actor.style = 'margin-top: 0px; padding-top: 0px;';
            } else {
                this.actor.style = 'margin-bottom: 0px; padding-bottom: 0px;';
            }

            this.pinnedAppsContr = new PinnedFavs(this);

            this.recentManager = Gtk.RecentManager.get_default();
            this.recentItems = this.recentManager.get_items().sort(function(a,b) { return  a.get_modified() -  b.get_modified(); } ).reverse();
	        this.recentManager.connect('changed', Lang.bind(this, this.on_recent_items_changed));

            this.metaWorkspaces = {};

            // Use a signal tracker so we don't have to keep track of all these id's manually!
            //  global.window_manager.connect('switch-workspace', Lang.bind(this, this._onSwitchWorkspace));
            //  global.screen.connect('notify::n-workspaces', Lang.bind(this, this._onWorkspaceCreatedOrDestroyed));
            //  Main.overview.connect('showing', Lang.bind(this, this._onOverviewShow));
            //  Main.overview.connect('hiding', Lang.bind(this, this._onOverviewHide));
            this.signals = new SignalTracker();
            this.signals.connect({
                object: global.window_manager,
                signalName: 'switch-workspace',
                callback: this._onSwitchWorkspace,
                bind: this
            });
            this.signals.connect({
                object: global.screen,
                signalName: 'notify::n-workspaces',
                callback: this._onWorkspaceCreatedOrDestroyed,
                bind: this
            });
            this.signals.connect({
                object: Main.overview,
                signalName: 'showing',
                callback: this._onOverviewShow,
                bind: this
            });
            this.signals.connect({
                object: Main.overview,
                signalName: 'hiding',
                callback: this._onOverviewHide,
                bind: this
            });
            this.signals.connect({
                object: Main.expo,
                signalName: 'showing',
                callback: this._onOverviewShow,
                bind: this
            });
            this.signals.connect({
                object: Main.expo,
                signalName: 'hiding',
                callback: this._onOverviewHide,
                bind: this
            });
            this._onSwitchWorkspace(null, null, global.screen.get_active_workspace_index());

            global.settings.connect('changed::panel-edit-mode', Lang.bind(this, this.on_panel_edit_mode_changed));
        } catch (e) {
            Main.notify("Error", e.message);
            global.logError(e);
        }
    },

    execInstallLanguage: function() {
        try {
            let _shareFolder = GLib.get_home_dir() + "/.local/share/";
            let _localeFolder = Gio.file_new_for_path(_shareFolder + "locale/");
            let _moFolder = Gio.file_new_for_path(_shareFolder + "cinnamon/applets/" + this._uuid + "/locale/mo/");

            let children = _moFolder.enumerate_children('standard::name,standard::type,time::modified',
                                                       Gio.FileQueryInfoFlags.NONE, null);
            let info, child, _moFile, _moLocale, _moPath;
                   
            while ((info = children.next_file(null)) !== null) {
                let type = info.get_file_type();
                let modified = info.get_modification_time().tv_sec;
                if (type == Gio.FileType.REGULAR) {
                    _moFile = info.get_name();
                    if (_moFile.substring(_moFile.lastIndexOf(".")) == ".mo") {
                        _moLocale = _moFile.substring(0, _moFile.lastIndexOf("."));
                        _moPath = _localeFolder.get_path() + "/" + _moLocale + "/LC_MESSAGES/";
                        let src = Gio.file_new_for_path(String(_moFolder.get_path() + "/" + _moFile));
                        let dest = Gio.file_new_for_path(String(_moPath + this._uuid + ".mo"));
                        let destModified = dest.query_info('time::modified', Gio.FileQueryInfoFlags.NONE, null).get_modification_time().tv_sec;
                        try {
                            if(dest && modified > destModified) {
                                this._makeDirectoy(dest.get_parent());
                                src.copy(dest, Gio.FileCopyFlags.OVERWRITE, null, null);
                            }else if (!dest){
                                this._makeDirectoy(dest.get_parent());
                                src.copy(dest, Gio.FileCopyFlags.OVERWRITE, null, null);
                            }
                        } catch(e) {
                            global.logError(e);
                        }
                    }
                }
            }
        } catch(e) {
            global.logError(e);
        }
    },

    _makeDirectoy: function(fDir) {
        if(!this._isDirectory(fDir))
            this._makeDirectoy(fDir.get_parent());
        if(!this._isDirectory(fDir))
            fDir.make_directory(null);
    },

    _isDirectory: function(fDir) {
        try {
            let info = fDir.query_filesystem_info("standard::type", null);
            if((info)&&(info.get_file_type() != Gio.FileType.DIRECTORY))
                return true;
        } catch(e) {
        }
        return false;
    },

    on_applet_clicked: function (event) {

    },

    on_panel_edit_mode_changed: function () {
        this.actor.reactive = global.settings.get_boolean("panel-edit-mode");
    },

    on_panel_height_changed: function () {
        for(let workSpace in this.metaWorkspaces){
            this.metaWorkspaces[workSpace].appList._refreshList();
        }
    },

    pinned_app_contr: function () {
        let pinnedAppsContr = this.pinnedAppsContr;
        return pinnedAppsContr;
    },

    acceptNewLauncher: function(path) {
        this.pinnedAppsContr.addFavorite(path);
    },

    removeLauncher: function (appGroup) {
        //Add code here to remove the launcher if you want.
    },
    
    recent_items_contr: function () {
        return this.recentItems;
    },

    recent_items_manager: function () {
        return this.recentManager;
    },

    _pinnedRecentChanged: function () {
        return;
    },

    on_recent_items_changed: function(){
        this.recentItems = this.recentManager.get_items().sort(function(a,b) { return  a.get_modified() -  b.get_modified(); } ).reverse();
    },

    _onWorkspaceCreatedOrDestroyed: function () {
        let workspaces = [global.screen.get_workspace_by_index(i) for each(i in range(global.screen.n_workspaces))];
        // We'd like to know what workspaces in this.metaWorkspaces have been destroyed and
        // so are no longer in the workspaces list.  For each of those, we should destroy them
        let toDelete = [];
        for(let workSpace in this.metaWorkspaces){
            if (workspaces.indexOf(this.metaWorkspaces[workSpace].ws) == -1) {
                this.metaWorkspaces[workSpace].appList.destroy();
                toDelete.push(this.metaWorkspaces[workSpace].ws);
            }
        }
        for(let i = 0;i<toDelete.length;i++){
            delete this.metaWorkspaces[toDelete[i]];
        }
    },

    _onSwitchWorkspace: function (winManager, previousWorkspaceIndex, currentWorkspaceIndex) {
        let metaWorkspace = global.screen.get_workspace_by_index(currentWorkspaceIndex);
        // If the workspace we switched to isn't in our list,
        // we need to create an AppList for it
        if (!this.metaWorkspaces[metaWorkspace]) {
            let appList = new AppList(this, metaWorkspace, this.orientation);
            this.metaWorkspaces[metaWorkspace] = {
                ws: metaWorkspace,
                appList: appList
            };
        }

        // this.actor can only have one child, so setting the child
        // will automatically unparent anything that was previously there, which
        // is exactly what we want.
        let list = this.metaWorkspaces[metaWorkspace].appList;
        this._box.set_child(list.actor);
        list._refreshApps();
    },

    _onOverviewShow: function () {
        this.actor.hide();
    },

    _onOverviewHide: function () {
        this.actor.show();
    },

    destroy: function () {
        this.signals.disconnectAll();
        this.actor.destroy();
        this.actor = null;
    }
};

function main(metadata, orientation, panel_height, instance_id) {
    let myApplet = new MyApplet(metadata, orientation, panel_height, instance_id);
    return myApplet;
}
