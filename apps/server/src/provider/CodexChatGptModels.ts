import type { ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";
import { codexDefaultReasoningEffort, reasoningEffortLabel } from "./codexReasoning.ts";

export class ChatGptCatalogError extends Schema.TaggedError<ChatGptCatalogError>()(
  "ChatGptCatalogError",
  { status: Schema.Int },
) {}

const Catalog = Schema.Struct({
  models: Schema.Array(
    Schema.Struct({
      slug: Schema.NonEmptyString,
      display_name: Schema.NonEmptyString,
      visibility: Schema.String,
      default_reasoning_level: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
      supported_reasoning_levels: Schema.optional(
        Schema.NullOr(
          Schema.Array(
            Schema.Struct({
              effort: Schema.NonEmptyString,
              description: Schema.optional(Schema.String),
            }),
          ),
        ),
      ),
    }),
  ),
});

export const chatGptModels = Effect.fn("chatGptModels")(function* (
  accessToken: string,
  nativeModels: ReadonlyArray<ServerProviderModel>,
) {
  const http = yield* HttpClient.HttpClient;
  const response = yield* http.execute(
    HttpClientRequest.get("https://api.openai.com/v1/models").pipe(
      HttpClientRequest.bearerToken(accessToken),
    ),
  );
  if (response.status !== 200) return yield* new ChatGptCatalogError({ status: response.status });
  const catalog = yield* response.json.pipe(Effect.flatMap(Schema.decodeUnknownEffect(Catalog)));
  return catalog.models
    .filter((model) => model.visibility === "list")
    .map((model) => {
      const native = nativeModels.find((candidate) => candidate.slug === model.slug);
      let capabilities = native?.capabilities ?? null;
      // The account catalog can be newer than the bundled CLI and restrict its reasoning choices.
      if (model.supported_reasoning_levels) {
        const defaultEffort = codexDefaultReasoningEffort(
          model.slug,
          model.default_reasoning_level,
        );
        const options = model.supported_reasoning_levels.map(({ effort, description }) => {
          const choiceDescription = description?.trim();
          return {
            id: effort,
            label: reasoningEffortLabel(effort),
            ...(choiceDescription ? { description: choiceDescription } : {}),
            ...(effort === defaultEffort ? { isDefault: true } : {}),
          };
        });
        const defaultReasoning = options.find((option) => option.isDefault)?.id;
        const optionDescriptors = (capabilities?.optionDescriptors ?? []).filter(
          (descriptor) => descriptor.id !== "reasoningEffort",
        );
        if (options.length > 0) {
          optionDescriptors.unshift({
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options,
            ...(defaultReasoning ? { currentValue: defaultReasoning } : {}),
          });
        }
        capabilities = createModelCapabilities({ optionDescriptors });
      }
      return {
        ...native,
        capabilities,
        slug: model.slug,
        name: model.display_name,
        isCustom: false,
      } satisfies ServerProviderModel;
    });
}, Effect.timeout("15 seconds"));
