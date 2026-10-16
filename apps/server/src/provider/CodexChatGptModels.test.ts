import { assert, it } from "@effect/vitest";
import type { ServerProviderModel } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { chatGptModels } from "./CodexChatGptModels.ts";

it.effect(
  "uses each selected profile's token and the server's visible catalog order and names",
  () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const http = HttpClient.make((request) =>
        Effect.sync(() => {
          assert.strictEqual(request.url, "https://api.openai.com/v1/models");
          requests.push(request.headers.authorization!);
          return HttpClientResponse.fromWeb(
            request,
            new Response(
              JSON.stringify({
                models:
                  request.headers.authorization === "Bearer account-a"
                    ? [
                        { slug: "second", display_name: "Second from OpenAI", visibility: "list" },
                        { slug: "hidden", display_name: "Hidden", visibility: "hidden" },
                        { slug: "first", display_name: "First from OpenAI", visibility: "list" },
                      ]
                    : [{ slug: "account-b-only", display_name: "B", visibility: "list" }],
              }),
            ),
          );
        }),
      );
      const native = [
        {
          slug: "first",
          name: "Cached first",
          isCustom: false,
          capabilities: { optionDescriptors: [] },
        },
        { slug: "not-entitled", name: "Cached other", isCustom: false, capabilities: null },
      ];
      const a = yield* chatGptModels("account-a", native).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      assert.deepEqual(
        a.map((model) => [model.slug, model.name]),
        [
          ["second", "Second from OpenAI"],
          ["first", "First from OpenAI"],
        ],
      );
      assert.deepEqual(a[1]!.capabilities, native[0]!.capabilities);
      assert.isNull(a[0]!.capabilities);
      const b = yield* chatGptModels("account-b", native).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      assert.deepEqual(
        b.map((model) => model.slug),
        ["account-b-only"],
      );
      assert.deepEqual(requests, ["Bearer account-a", "Bearer account-b"]);
    }),
);

it.effect("does not present a cached catalog as account entitlements when discovery fails", () =>
  Effect.gen(function* () {
    const http = HttpClient.make((request) =>
      Effect.succeed(HttpClientResponse.fromWeb(request, new Response(null, { status: 503 }))),
    );
    const error = yield* Effect.flip(
      chatGptModels("account-a", []).pipe(Effect.provideService(HttpClient.HttpClient, http)),
    );
    assert.strictEqual(error._tag, "ChatGptCatalogError");
  }),
);

it.effect("discovers GPT-6.1 Sol reasoning levels before the bundled CLI knows the model", () =>
  Effect.gen(function* () {
    const http = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            models: [
              {
                slug: "gpt-6.1-sol",
                display_name: "GPT-6.1 Sol",
                visibility: "list",
                default_reasoning_level: "low",
                supported_reasoning_levels: [
                  { effort: "low", description: "Fast responses with lighter reasoning" },
                  { effort: "medium" },
                  { effort: "high" },
                  { effort: "xhigh" },
                  { effort: "max" },
                  { effort: "ultra" },
                ],
              },
            ],
          }),
        ),
      ),
    );
    const models = yield* chatGptModels("account-a", []).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    );
    assert.deepStrictEqual(models[0]?.capabilities?.optionDescriptors, [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        currentValue: "low",
        options: [
          {
            id: "low",
            label: "Low",
            description: "Fast responses with lighter reasoning",
            isDefault: true,
          },
          { id: "medium", label: "Medium" },
          { id: "high", label: "High" },
          { id: "xhigh", label: "Extra High" },
          { id: "max", label: "Max" },
          { id: "ultra", label: "Ultra" },
        ],
      },
    ]);
  }),
);

const nativeModel: ServerProviderModel = {
  slug: "gpt-6.1-sol",
  name: "Cached Sol",
  isCustom: false,
  capabilities: {
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        currentValue: "ultra",
        options: [{ id: "ultra", label: "Ultra", isDefault: true }],
      },
      { id: "fastMode", label: "Fast mode", type: "boolean" },
    ],
  },
};

it.effect(
  "uses the account's reasoning choices and default while preserving other CLI controls",
  () =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              models: [
                {
                  slug: "gpt-6.1-sol",
                  display_name: "GPT-6.1 Sol",
                  visibility: "list",
                  default_reasoning_level: "max",
                  supported_reasoning_levels: [
                    { effort: "high", description: "" },
                    { effort: "max", description: "Maximum reasoning" },
                  ],
                },
              ],
            }),
          ),
        ),
      );
      const models = yield* chatGptModels("account-a", [nativeModel]).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      assert.deepStrictEqual(models[0]?.capabilities?.optionDescriptors, [
        {
          id: "reasoningEffort",
          label: "Reasoning",
          type: "select",
          currentValue: "max",
          options: [
            { id: "high", label: "High" },
            { id: "max", label: "Max", description: "Maximum reasoning", isDefault: true },
          ],
        },
        { id: "fastMode", label: "Fast mode", type: "boolean" },
      ]);
    }),
);

it.effect.each([undefined, null])(
  "keeps native reasoning controls when catalog reasoning metadata is %s",
  (levels) =>
    Effect.gen(function* () {
      const http = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json({
              models: [
                {
                  slug: "gpt-6.1-sol",
                  display_name: "GPT-6.1 Sol",
                  visibility: "list",
                  supported_reasoning_levels: levels,
                },
              ],
            }),
          ),
        ),
      );
      const models = yield* chatGptModels("account-a", [nativeModel]).pipe(
        Effect.provideService(HttpClient.HttpClient, http),
      );
      assert.deepStrictEqual(models[0]?.capabilities, nativeModel.capabilities);
    }),
);

it.effect("removes stale native reasoning controls when the catalog advertises none", () =>
  Effect.gen(function* () {
    const http = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            models: [
              {
                slug: "gpt-6.1-sol",
                display_name: "GPT-6.1 Sol",
                visibility: "list",
                default_reasoning_level: null,
                supported_reasoning_levels: [],
              },
            ],
          }),
        ),
      ),
    );
    const models = yield* chatGptModels("account-a", [nativeModel]).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    );
    assert.deepStrictEqual(models[0]?.capabilities?.optionDescriptors, [
      { id: "fastMode", label: "Fast mode", type: "boolean" },
    ]);
  }),
);

it.effect("preserves T3's medium reasoning default for Astra", () =>
  Effect.gen(function* () {
    const http = HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({
            models: [
              {
                slug: "gpt-6-astra",
                display_name: "GPT-6 Astra",
                visibility: "list",
                default_reasoning_level: "low",
                supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }],
              },
            ],
          }),
        ),
      ),
    );
    const models = yield* chatGptModels("account-a", []).pipe(
      Effect.provideService(HttpClient.HttpClient, http),
    );
    assert.deepStrictEqual(models[0]?.capabilities?.optionDescriptors, [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select",
        currentValue: "medium",
        options: [
          { id: "low", label: "Low" },
          { id: "medium", label: "Medium", isDefault: true },
        ],
      },
    ]);
  }),
);
