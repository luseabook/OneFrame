import { Controller, Get, Param, Post, Query, Req, ParseIntPipe , Inject} from "@nestjs/common";
import type { AuthedRequest } from "../../common/auth.types";
import { TasksService } from "./tasks.service";

@Controller()
export class TasksController {
  constructor(@Inject(TasksService) private readonly tasks: TasksService) {}

  @Get("tasks")
  async list(
    @Req() req: AuthedRequest,
    @Query("ids") ids?: string,
    @Query("page") page?: string,
    @Query("page_size") pageSize?: string,
    @Query("status") status?: string,
    @Query("capability") capability?: string,
  ) {
    const spaceId = req.auth?.spaceId ?? "";
    if (ids) {
      return this.tasks.getMany(
        spaceId,
        ids.split(",").map((id) => id.trim()).filter(Boolean),
      );
    }
    return this.tasks.list(spaceId, {
      page: page ? Number(page) : undefined,
      page_size: pageSize ? Number(pageSize) : undefined,
      status: status ? Number(status) : undefined,
      capability,
    });
  }

  @Get("tasks/:id")
  async detail(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.detail(req.auth?.spaceId ?? "", id);
  }

  @Post("tasks/:id/cancel")
  async cancel(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.cancel(req.auth?.spaceId ?? "", id);
  }

  @Post("tasks/:id/retry")
  async retry(@Req() req: AuthedRequest, @Param("id") id: string) {
    return this.tasks.retry(req.auth?.spaceId ?? "", id);
  }

  @Get("tasks/:id/results/:n/download-url")
  async downloadUrl(
    @Req() req: AuthedRequest,
    @Param("id") id: string,
    @Param("n", ParseIntPipe) n: number,
  ) {
    return this.tasks.downloadUrl(req.auth?.spaceId ?? "", id, n);
  }
}
