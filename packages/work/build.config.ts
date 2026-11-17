import { defineBuildConfig } from "unbuild"

export default defineBuildConfig({
  entries: ["./src/index", "./src/managed"],
  declaration: true,
  clean: true,
  rollup: {
    emitCJS: true,
  },
})