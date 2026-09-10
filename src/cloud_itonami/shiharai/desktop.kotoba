(ns cloud-itonami.shiharai.desktop
  "Entry point for the shadow-cljs :app build (web/dist/js/main.js, loaded
  by web/index.html) — same mount pattern as murakumo-studio.desktop,
  cloud-itonami.app-itonami.desktop and cloud-itonami.port.desktop."
  (:require [reagent.dom.client :as rdomc]
            [cloud-itonami.shiharai.ui :as ui]))

(defonce root (atom nil))

(defn- mount! []
  (let [el (.getElementById js/document "app")]
    (when-not @root
      (reset! root (rdomc/create-root el)))
    (rdomc/render @root [ui/root])))

(defn init! []
  ;; reagent's r/atom re-renders subscribed components on change
  ;; (ui/root derefs state/state) — mount once.
  (mount!))
