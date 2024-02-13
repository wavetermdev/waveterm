import { Model } from "./model";
import { CommandRunner } from "./commandrunner";

const GlobalModel: Model = Model.getInstance();
const GlobalCommandRunner: CommandRunner = CommandRunner.getInstance();
export { GlobalModel, GlobalCommandRunner };
