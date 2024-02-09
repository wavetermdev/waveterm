import { Model } from "./model";
import { CommandRunner } from "./commandrunner";

const GlobalModel = Model.getInstance();
const GlobalCommandRunner = CommandRunner.getInstance();
export { GlobalModel, GlobalCommandRunner };
