import { z } from "zod";
import type { VContextAPI } from "./api.js";
import {
  InputSchemaChangesAdd,
  InputSchemaChangesList,
  InputSchemaContext,
  InputSchemaDocumentsAdd,
  InputSchemaDocumentsDelete,
  InputSchemaDocumentsGet,
  InputSchemaDocumentsList,
  InputSchemaDocumentsUpdate,
  InputSchemaFileContextDelete,
  InputSchemaFileContextList,
  InputSchemaFileContextUpsert,
  InputSchemaProjects,
  InputSchemaPromptsAdd,
  InputSchemaPromptsDelete,
  InputSchemaPromptsList,
  InputSchemaPromptsUpdate,
  InputSchemaTasksAdd,
  InputSchemaTasksDelete,
  InputSchemaTasksList,
  InputSchemaTasksUpdate,
} from "./schemas.js";

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodTypeAny;
  readonly handler: (
    args: Record<string, unknown>,
  ) => Promise<{ content: Array<{ type: "text"; text: string }> }>;
}

function content(result: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(result) }] };
}

// allow: SIZE_OK — MCP tool definitions form one protocol registry.
export function createToolDefinitions(api: VContextAPI): ToolDefinition[] {
  return [
    {
      name: "vcontext_context",
      description:
        "Get compact project context for AI agents. Omits usage instructions and CLI reference, truncates documents, caps changes at 5.",
      inputSchema: InputSchemaContext,
      handler: async (args) => {
        const parsed = InputSchemaContext.parse(args);
        return content(await api.renderContext(parsed.slug, { compact: true }));
      },
    },
    {
      name: "vcontext_projects",
      description: "List all registered vcontext projects.",
      inputSchema: InputSchemaProjects,
      handler: async (args) => {
        InputSchemaProjects.parse(args);
        return content(await api.listProjects());
      },
    },
    {
      name: "vcontext_tasks_list",
      description: "List tasks for a project.",
      inputSchema: InputSchemaTasksList,
      handler: async (args) => {
        const parsed = InputSchemaTasksList.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.tasks.list());
      },
    },
    {
      name: "vcontext_tasks_add",
      description: "Add a task to a project.",
      inputSchema: InputSchemaTasksAdd,
      handler: async (args) => {
        const parsed = InputSchemaTasksAdd.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(
          await project.tasks.add({
            title: parsed.title,
            description: parsed.description,
            status: parsed.status,
          }),
        );
      },
    },
    {
      name: "vcontext_tasks_update",
      description: "Update a task in a project.",
      inputSchema: InputSchemaTasksUpdate,
      handler: async (args) => {
        const parsed = InputSchemaTasksUpdate.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(
          await project.tasks.update(parsed.taskId, {
            title: parsed.title,
            description: parsed.description,
            status: parsed.status,
          }),
        );
      },
    },
    {
      name: "vcontext_tasks_delete",
      description: "Delete a task from a project.",
      inputSchema: InputSchemaTasksDelete,
      handler: async (args) => {
        const parsed = InputSchemaTasksDelete.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.tasks.delete(parsed.taskId));
      },
    },
    {
      name: "vcontext_documents_list",
      description: "List documents for a project.",
      inputSchema: InputSchemaDocumentsList,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsList.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.documents.list());
      },
    },
    {
      name: "vcontext_documents_get",
      description: "Get a project document by ID.",
      inputSchema: InputSchemaDocumentsGet,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsGet.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.documents.get(parsed.documentId));
      },
    },
    {
      name: "vcontext_documents_add",
      description: "Add a document to a project.",
      inputSchema: InputSchemaDocumentsAdd,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsAdd.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(
          await project.documents.add({
            title: parsed.title,
            content: parsed.content,
          }),
        );
      },
    },
    {
      name: "vcontext_documents_update",
      description: "Update a document in a project.",
      inputSchema: InputSchemaDocumentsUpdate,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsUpdate.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(
          await project.documents.update(parsed.documentId, {
            title: parsed.title,
            content: parsed.content,
          }),
        );
      },
    },
    {
      name: "vcontext_documents_delete",
      description: "Delete a document from a project.",
      inputSchema: InputSchemaDocumentsDelete,
      handler: async (args) => {
        const parsed = InputSchemaDocumentsDelete.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.documents.delete(parsed.documentId));
      },
    },
    {
      name: "vcontext_changes_list",
      description: "List changes recorded for a project.",
      inputSchema: InputSchemaChangesList,
      handler: async (args) => {
        const parsed = InputSchemaChangesList.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.changes.list());
      },
    },
    {
      name: "vcontext_changes_add",
      description: "Record a change for a project.",
      inputSchema: InputSchemaChangesAdd,
      handler: async (args) => {
        const parsed = InputSchemaChangesAdd.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(
          await project.changes.add({
            note: parsed.note,
            document_id: parsed.document_id,
          }),
        );
      },
    },
    {
      name: "vcontext_file_context_list",
      description: "List file context entries for a project.",
      inputSchema: InputSchemaFileContextList,
      handler: async (args) => {
        const parsed = InputSchemaFileContextList.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.fileContexts.list());
      },
    },
    {
      name: "vcontext_file_context_upsert",
      description: "Create or update a file context entry for a project.",
      inputSchema: InputSchemaFileContextUpsert,
      handler: async (args) => {
        const parsed = InputSchemaFileContextUpsert.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(
          await project.fileContexts.upsert({
            path: parsed.path,
            description: parsed.description,
            kind: parsed.kind,
            filename: parsed.filename,
            hash: parsed.hash,
          }),
        );
      },
    },
    {
      name: "vcontext_file_context_delete",
      description: "Delete a file context entry from a project.",
      inputSchema: InputSchemaFileContextDelete,
      handler: async (args) => {
        const parsed = InputSchemaFileContextDelete.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(
          await project.fileContexts.delete(parsed.fileContextId),
        );
      },
    },
    {
      name: "vcontext_prompts_list",
      description: "List prompts for a project.",
      inputSchema: InputSchemaPromptsList,
      handler: async (args) => {
        const parsed = InputSchemaPromptsList.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.prompts.list());
      },
    },
    {
      name: "vcontext_prompts_add",
      description: "Add a prompt to a project.",
      inputSchema: InputSchemaPromptsAdd,
      handler: async (args) => {
        const parsed = InputSchemaPromptsAdd.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.prompts.add({ prompt: parsed.prompt }));
      },
    },
    {
      name: "vcontext_prompts_update",
      description: "Update a prompt in a project.",
      inputSchema: InputSchemaPromptsUpdate,
      handler: async (args) => {
        const parsed = InputSchemaPromptsUpdate.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(
          await project.prompts.update(parsed.promptId, {
            prompt: parsed.prompt,
          }),
        );
      },
    },
    {
      name: "vcontext_prompts_delete",
      description: "Delete a prompt from a project.",
      inputSchema: InputSchemaPromptsDelete,
      handler: async (args) => {
        const parsed = InputSchemaPromptsDelete.parse(args);
        const project = await api.getProject(parsed.slug);
        return content(await project.prompts.delete(parsed.promptId));
      },
    },
  ];
}
