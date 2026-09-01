import { tool } from "@opencode-ai/plugin";

export const schema = tool.schema;

// Конвертер декларативных args-дескрипторов в zod-схемы opencode.
// Позволяет тулзам описывать args framework-agnostic:
//   { type: "string" }, { type: "string", enum: [...] },
//   { type: "array", items: { type: "string" }, optional: true }
// Если значение уже zod-схема — проходит как есть.
function toSchema(spec) {
  if (!spec || typeof spec !== "object" || !spec.type) return spec;
  let s;
  switch (spec.type) {
    case "boolean":
      s = schema.boolean();
      break;
    case "number":
      s = schema.number();
      break;
    case "array":
      s = schema.array(toSchema(spec.items || { type: "string" }));
      break;
    case "object":
      s = schema.record(schema.any());
      break;
    case "string":
    default:
      s = spec.enum ? schema.enum(spec.enum) : schema.string();
  }
  if (spec.optional && typeof s?.optional === "function") s = s.optional();
  return s;
}

// v10.x: opencode требует string из execute() — сериализуем любой return
export function defineTool(def) {
  const args = {};
  for (const [k, v] of Object.entries(def.args || {})) args[k] = toSchema(v);

  const orig = def.execute;
  return tool({
    description: def.description,
    args,
    async execute(args, ctx) {
      const res = await orig(args, ctx);
      return typeof res === "string" ? res : JSON.stringify(res, null, 2);
    },
  });
}
