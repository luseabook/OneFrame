import { Body, Controller, Headers, Post, Req , Inject} from "@nestjs/common";
import { generationRequestSchema } from "@app/shared";
import type { AuthedRequest } from "../../common/auth.types";
import { parseOrThrow } from "../../common/zod";
import { GenerationsService } from "./generations.service";

@Controller()
export class GenerationsController {
  constructor(@Inject(GenerationsService) private readonly generations: GenerationsService) {}

  @Post("generations")
  async create(
    @Req() req: AuthedRequest,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: unknown,
  ) {
    if (!idempotencyKey) {
      const { AppError, ErrorCode } = await import("@app/shared");
      throw new AppError(ErrorCode.BAD_REQUEST, "Idempotency-Key header required");
    }
    const input = parseOrThrow(generationRequestSchema, body);
    const auth = req.auth;
    if (!auth) throw new Error("auth missing");
    return this.generations.create(auth, input, idempotencyKey);
  }
}
