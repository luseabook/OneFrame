import { BadRequestException, Controller, Get, Query , Inject} from "@nestjs/common";
import { ModelsService } from "./models.service";

@Controller()
export class ModelsController {
  constructor(@Inject(ModelsService) private readonly models: ModelsService) {}

  @Get("models")
  async list(
    @Query("capability") capability?: string,
    @Query("mode") mode?: string,
    @Query("visible") visible?: string,
  ) {
    if (visible !== undefined && visible !== "true" && visible !== "false") {
      throw new BadRequestException("visible must be true|false");
    }
    return this.models.list({
      capability,
      mode,
      visible: visible === undefined ? undefined : visible === "true",
    });
  }
}
