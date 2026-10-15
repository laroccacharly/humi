import { Runtime } from "foldkit"

import { init, subscriptions } from "./main.ts"
import { Model } from "./model.ts"
import { update } from "./update.ts"
import { view } from "./view.ts"

const application = Runtime.makeApplication({
  Model,
  init,
  update,
  view,
  subscriptions,
  container: document.querySelector("#root"),
})

Runtime.run(application)
