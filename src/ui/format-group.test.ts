import { describe, expect, test } from "bun:test";
import { formatGroupEvent } from "ui/format";
import { PartyOperation, PartyResult } from "wow/protocol/opcodes";

describe("formatGroupEvent", () => {
  test("invite success", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.SUCCESS,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Invited Voidtrix");
  });

  test("invite failure", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.BAD_PLAYER_NAME,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: player not found");
  });

  test("uninvite success", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.UNINVITE,
        result: PartyResult.SUCCESS,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Removed Voidtrix from group");
  });

  test("uninvite failure", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.UNINVITE,
        result: PartyResult.NOT_LEADER,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot kick Voidtrix: you are not the leader");
  });

  test("leave success", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.LEAVE,
        result: PartyResult.SUCCESS,
        target: "",
        type: "command_result",
      }),
    ).toBe("[group] Left the group");
  });

  test("leave failure", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.LEAVE,
        result: PartyResult.NOT_LEADER,
        target: "",
        type: "command_result",
      }),
    ).toBe("[group] Cannot leave: you are not the leader");
  });

  test("command_result with empty target omits extra space", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.UNINVITE,
        result: PartyResult.NOT_LEADER,
        target: "",
        type: "command_result",
      }),
    ).toBe("[group] Cannot kick: you are not the leader");
  });

  test("invite failure with group full label", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.GROUP_FULL,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: group is full");
  });

  test("invite failure with already in group label", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.ALREADY_IN_GROUP,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: already in a group");
  });

  test("invite failure with wrong faction label", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.PLAYER_WRONG_FACTION,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: wrong faction");
  });

  test("invite failure with ignoring you label", () => {
    expect(
      formatGroupEvent({
        operation: PartyOperation.INVITE,
        result: PartyResult.IGNORING_YOU,
        target: "Voidtrix",
        type: "command_result",
      }),
    ).toBe("[group] Cannot invite Voidtrix: player is ignoring you");
  });

  test("leader changed", () => {
    expect(formatGroupEvent({ name: "Alice", type: "leader_changed" })).toBe(
      "[group] Alice is now the group leader",
    );
  });

  test("group destroyed", () => {
    expect(formatGroupEvent({ type: "group_destroyed" })).toBe(
      "[group] Group has been disbanded",
    );
  });

  test("kicked", () => {
    expect(formatGroupEvent({ type: "kicked" })).toBe(
      "[group] You have been removed from the group",
    );
  });

  test("invite declined", () => {
    expect(formatGroupEvent({ name: "Bob", type: "invite_declined" })).toBe(
      "[group] Bob has declined your invitation",
    );
  });

  test("group_list returns undefined", () => {
    expect(
      formatGroupEvent({
        leader: "",
        members: [],
        type: "group_list",
      }),
    ).toBeUndefined();
  });
});
