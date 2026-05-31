/**
 * Behaviour tests for the incident automation actions. Triggers don't
 * need their own tests — they're plain shape declarations against the
 * existing hooks (`incidentHooks`) and the registry tests in
 * `core/automation-backend` cover registration validity.
 */
import { describe, it, expect, mock } from "bun:test";
import { createMockLogger } from "@checkstack/test-utils-backend";

import { createIncidentActions } from "./automations";
import type { IncidentService } from "./service";

const makeServiceStub = (overrides: Partial<IncidentService> = {}) =>
  ({
    createIncident: mock(),
    resolveIncident: mock(),
    addUpdate: mock(),
    ...overrides,
  }) as unknown as IncidentService;

const logger = createMockLogger();

const actionContext = {
  consumedArtifacts: {},
  runId: "run-1",
  automationId: "auto-1",
  contextKey: "INC-1",
  logger,
  getService: async <T,>(): Promise<T> => {
    throw new Error("not used");
  },
};

describe("incident automation actions", () => {
  describe("incident.create", () => {
    it("calls service.createIncident with the config payload", async () => {
      const created = {
        id: "INC-1",
        status: "investigating",
        severity: "critical",
        systemIds: ["sys-1"],
      };
      const service = makeServiceStub({
        createIncident: mock(
          async () => created,
        ) as unknown as IncidentService["createIncident"],
      });
      const [createAction] = createIncidentActions({ service });
      const result = await createAction.execute({
        ...actionContext,
        config: {
          title: "DB down",
          severity: "critical",
          systemIds: ["sys-1"],
          suppressNotifications: false,
        } as never,
      });
      expect(result.success).toBe(true);
      expect((result.artifact as { incidentId: string }).incidentId).toBe(
        "INC-1",
      );
      // The action now reserves an id up front and passes it (with no user)
      // so the reactive `incident` entity can key on it and snapshot a null
      // `prev` before the insert (§10.1).
      expect(service.createIncident).toHaveBeenCalledWith(
        {
          title: "DB down",
          description: undefined,
          severity: "critical",
          systemIds: ["sys-1"],
          initialMessage: undefined,
          suppressNotifications: false,
        },
        undefined,
        expect.any(String),
      );
    });

    it("dedupe_open_for_system reuses an existing open incident on the system", async () => {
      const existing = {
        id: "INC-OPEN",
        status: "investigating",
        severity: "critical",
        systemIds: ["sys-1"],
      };
      const service = makeServiceStub({
        // The action now delegates the dedup-serialized find-then-create to
        // the service (which wraps it in an advisory lock).
        createIncidentDedupedForSystem: mock(async () => ({
          incident: existing,
          reused: true,
        })) as unknown as IncidentService["createIncidentDedupedForSystem"],
        createIncident: mock() as unknown as IncidentService["createIncident"],
      });
      const [createAction] = createIncidentActions({ service });
      const result = await createAction.execute({
        ...actionContext,
        config: {
          title: "DB down",
          severity: "critical",
          systemIds: ["sys-1"],
          suppressNotifications: false,
          dedupe_open_for_system: true,
        } as never,
      });
      expect(result.success).toBe(true);
      expect((result.artifact as { incidentId: string }).incidentId).toBe(
        "INC-OPEN",
      );
      // Reused via the dedup method — no direct createIncident call.
      expect(service.createIncident).not.toHaveBeenCalled();
      expect(service.createIncidentDedupedForSystem).toHaveBeenCalledTimes(1);
    });

    it("dedupe_open_for_system creates when no open incident exists", async () => {
      const created = {
        id: "INC-NEW",
        status: "investigating",
        severity: "critical",
        systemIds: ["sys-1"],
      };
      const service = makeServiceStub({
        createIncidentDedupedForSystem: mock(async () => ({
          incident: created,
          reused: false,
        })) as unknown as IncidentService["createIncidentDedupedForSystem"],
      });
      const [createAction] = createIncidentActions({ service });
      const result = await createAction.execute({
        ...actionContext,
        config: {
          title: "DB down",
          severity: "critical",
          systemIds: ["sys-1"],
          suppressNotifications: false,
          dedupe_open_for_system: true,
        } as never,
      });
      expect((result.artifact as { incidentId: string }).incidentId).toBe(
        "INC-NEW",
      );
      expect(service.createIncidentDedupedForSystem).toHaveBeenCalledTimes(1);
    });

    it("without the flag always creates (no dedup lookup)", async () => {
      const service = makeServiceStub({
        findActiveIncidentForSystem: mock(
          async () => ({
            id: "INC-OPEN",
            status: "investigating",
            severity: "critical",
            systemIds: ["sys-1"],
          }),
        ) as unknown as IncidentService["findActiveIncidentForSystem"],
        createIncident: mock(
          async () => ({
            id: "INC-NEW",
            status: "investigating",
            severity: "critical",
            systemIds: ["sys-1"],
          }),
        ) as unknown as IncidentService["createIncident"],
      });
      const [createAction] = createIncidentActions({ service });
      const result = await createAction.execute({
        ...actionContext,
        config: {
          title: "DB down",
          severity: "critical",
          systemIds: ["sys-1"],
          suppressNotifications: false,
          // dedupe_open_for_system omitted (defaults false)
        } as never,
      });
      expect((result.artifact as { incidentId: string }).incidentId).toBe(
        "INC-NEW",
      );
      expect(service.findActiveIncidentForSystem).not.toHaveBeenCalled();
    });

    // 6(a): an action-created incident is now reactive — the create runs
    // through `handle.mutate`, so the deriver fires `incident.created`.
    it("drives the create through handle.mutate (action-created incident is reactive)", async () => {
      const created = {
        id: "INC-NEW",
        status: "investigating" as const,
        severity: "critical" as const,
        systemIds: ["sys-1"],
      };
      const service = makeServiceStub({
        createIncident: mock(
          async () => created,
        ) as unknown as IncidentService["createIncident"],
      });
      const mutate = mock(
        async (input: { id: string; apply: () => Promise<unknown> }) =>
          input.apply(),
      );
      const handle = { kind: "incident", mutate } as never;
      const [createAction] = createIncidentActions({
        service,
        getIncidentEntity: () => handle,
      });
      await createAction.execute({
        ...actionContext,
        config: {
          title: "DB down",
          severity: "critical",
          systemIds: ["sys-1"],
          suppressNotifications: false,
        } as never,
      });
      // The create was routed through the entity handle (reactive), keyed on
      // the reserved id passed to the service create.
      expect(mutate).toHaveBeenCalledTimes(1);
      const mutateArg = mutate.mock.calls[0]![0] as { id: string };
      expect(service.createIncident).toHaveBeenCalledWith(
        expect.anything(),
        undefined,
        mutateArg.id,
      );
    });

    it("dedupe reuse drives NO handle.mutate (no duplicate incident.created)", async () => {
      const existing = {
        id: "INC-OPEN",
        status: "investigating" as const,
        severity: "critical" as const,
        systemIds: ["sys-1"],
      };
      const service = makeServiceStub({
        createIncidentDedupedForSystem: mock(async () => ({
          incident: existing,
          reused: true,
        })) as unknown as IncidentService["createIncidentDedupedForSystem"],
      });
      const mutate = mock(
        async (input: { id: string; apply: () => Promise<unknown> }) =>
          input.apply(),
      );
      const handle = { kind: "incident", mutate } as never;
      const [createAction] = createIncidentActions({
        service,
        getIncidentEntity: () => handle,
      });
      await createAction.execute({
        ...actionContext,
        config: {
          title: "DB down",
          severity: "critical",
          systemIds: ["sys-1"],
          suppressNotifications: false,
          dedupe_open_for_system: true,
        } as never,
      });
      // A reused incident is unchanged → no entity write at all.
      expect(mutate).not.toHaveBeenCalled();
    });
  });

  describe("incident.resolve", () => {
    it("returns failure when the incident doesn't exist", async () => {
      const service = makeServiceStub({
        resolveIncident: mock(
          async () => undefined,
        ) as unknown as IncidentService["resolveIncident"],
      });
      const actions = createIncidentActions({ service });
      const resolveAction = actions[1];
      const result = await resolveAction.execute({
        ...actionContext,
        config: { incidentId: "missing" } as never,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not found/i);
    });

    it("calls service.resolveIncident on the happy path", async () => {
      const resolved = {
        id: "INC-1",
        status: "resolved",
        severity: "critical",
        systemIds: ["sys-1"],
      };
      const service = makeServiceStub({
        resolveIncident: mock(
          async () => resolved,
        ) as unknown as IncidentService["resolveIncident"],
      });
      const actions = createIncidentActions({ service });
      const resolveAction = actions[1];
      const result = await resolveAction.execute({
        ...actionContext,
        config: { incidentId: "INC-1", message: "Fixed" } as never,
      });
      expect(result.success).toBe(true);
      expect(service.resolveIncident).toHaveBeenCalledWith("INC-1", "Fixed");
    });
  });

  describe("incident.add_update", () => {
    it("forwards message + statusChange to service.addUpdate", async () => {
      const update = {
        id: "upd-1",
        incidentId: "INC-1",
        message: "msg",
        createdAt: new Date(),
      };
      const service = makeServiceStub({
        addUpdate: mock(
          async () => update,
        ) as unknown as IncidentService["addUpdate"],
      });
      const actions = createIncidentActions({ service });
      const addUpdateAction = actions[2];
      const result = await addUpdateAction.execute({
        ...actionContext,
        config: {
          incidentId: "INC-1",
          message: "Investigating",
          statusChange: "identified",
        } as never,
      });
      expect(result.success).toBe(true);
      expect(service.addUpdate).toHaveBeenCalledWith({
        incidentId: "INC-1",
        message: "Investigating",
        statusChange: "identified",
      });
    });
  });

  describe("incident.update_status", () => {
    it("delegates to addUpdate with a generated audit message", async () => {
      const update = {
        id: "upd-2",
        incidentId: "INC-1",
        message: "Status changed to monitoring",
        createdAt: new Date(),
      };
      const service = makeServiceStub({
        addUpdate: mock(
          async () => update,
        ) as unknown as IncidentService["addUpdate"],
      });
      const actions = createIncidentActions({ service });
      const updateStatusAction = actions[3];
      const result = await updateStatusAction.execute({
        ...actionContext,
        config: { incidentId: "INC-1", status: "monitoring" } as never,
      });
      expect(result.success).toBe(true);
      expect(service.addUpdate).toHaveBeenCalledWith({
        incidentId: "INC-1",
        message: "Status changed to monitoring",
        statusChange: "monitoring",
      });
    });
  });

  describe("incident artifact (produces / consumes)", () => {
    it("incident.create declares produces: incident", () => {
      const [createAction] = createIncidentActions({
        service: makeServiceStub(),
      });
      expect(createAction.produces).toBe("incident");
    });

    it("incident.resolve consumes the upstream incident artifact when incidentId is omitted", async () => {
      const resolved = {
        id: "INC-9",
        status: "resolved",
        severity: "critical",
        systemIds: ["sys-1"],
      };
      const service = makeServiceStub({
        resolveIncident: mock(
          async () => resolved,
        ) as unknown as IncidentService["resolveIncident"],
      });
      const resolveAction = createIncidentActions({ service })[1];
      expect(resolveAction.consumes).toEqual(["incident"]);

      const result = await resolveAction.execute({
        ...actionContext,
        // No incidentId in config — falls back to the consumed artifact.
        config: { message: "recovered" } as never,
        consumedArtifacts: {
          incident: { incidentId: "INC-9", status: "investigating" },
        },
      });
      expect(result.success).toBe(true);
      expect(service.resolveIncident).toHaveBeenCalledWith("INC-9", "recovered");
    });

    it("incident.resolve config incidentId takes priority over the artifact", async () => {
      const service = makeServiceStub({
        resolveIncident: mock(
          async () => ({
            id: "INC-CONFIG",
            status: "resolved",
            severity: "high",
            systemIds: [],
          }),
        ) as unknown as IncidentService["resolveIncident"],
      });
      const resolveAction = createIncidentActions({ service })[1];
      await resolveAction.execute({
        ...actionContext,
        config: { incidentId: "INC-CONFIG" } as never,
        consumedArtifacts: { incident: { incidentId: "INC-ARTIFACT" } },
      });
      expect(service.resolveIncident).toHaveBeenCalledWith(
        "INC-CONFIG",
        undefined,
      );
    });

    it("incident.resolve fails clearly when neither config nor artifact has an id", async () => {
      const service = makeServiceStub();
      const resolveAction = createIncidentActions({ service })[1];
      const result = await resolveAction.execute({
        ...actionContext,
        config: {} as never,
        consumedArtifacts: {},
      });
      expect(result.success).toBe(false);
      expect(service.resolveIncident).not.toHaveBeenCalled();
    });
  });
});
