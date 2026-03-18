import {
  set_trial_context,
  type StimBank,
  type StimSpec,
  type TaskSettings,
  type TrialBuilder,
  type TrialSnapshot
} from "psyflow-web";

import {
  Controller,
  PLAYER_LEFT,
  PLAYER_PARTICIPANT,
  PLAYER_RIGHT
} from "./controller";

interface PlayerNames {
  participant: string;
  left: string;
  right: string;
}

interface TossOutcome {
  from_player: number;
  to_player: number;
  from_player_id: string;
  to_player_id: string;
  from_player_name: string;
  to_player_name: string;
  participant_turn: boolean;
  avatar_turn: boolean;
  participant_response: string;
  participant_rt: number | null;
  participant_timed_out: boolean;
  participant_received: boolean;
}

function normalizeKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeCondition(value: unknown): string {
  const token = String(value ?? "")
    .trim()
    .toLowerCase();
  return token.length > 0 ? token : "inclusion";
}

function titleCase(token: string): string {
  const value = normalizeCondition(token);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isPlayerId(value: number): boolean {
  return (
    value === PLAYER_PARTICIPANT ||
    value === PLAYER_LEFT ||
    value === PLAYER_RIGHT
  );
}

function toPlayerId(value: unknown, fallback: number): number {
  const parsed = Math.trunc(Number(value));
  return isPlayerId(parsed) ? parsed : fallback;
}

function playerKey(player: number): string {
  if (player === PLAYER_PARTICIPANT) {
    return "participant";
  }
  if (player === PLAYER_LEFT) {
    return "left";
  }
  return "right";
}

function playerName(player: number, names: PlayerNames): string {
  const key = playerKey(player) as keyof PlayerNames;
  return names[key];
}

function maxDeadline(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (Array.isArray(value) && value.length > 0) {
    const numbers = value
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item));
    if (numbers.length > 0) {
      return Math.max(0, Math.max(...numbers));
    }
  }
  return Math.max(0, fallback);
}

function nodePosition(stimBank: StimBank, nodeId: string): [number, number] {
  const spec = stimBank.resolve(nodeId);
  const [x = 0, y = 0] = spec.pos ?? [0, 0];
  const safeX = Number.isFinite(Number(x)) ? Number(x) : 0;
  const safeY = Number.isFinite(Number(y)) ? Number(y) : 0;
  return [safeX, safeY];
}

function ballPositionForPlayer(stimBank: StimBank, player: number): [number, number] {
  if (player === PLAYER_PARTICIPANT) {
    return nodePosition(stimBank, "participant_node");
  }
  if (player === PLAYER_LEFT) {
    return nodePosition(stimBank, "left_node");
  }
  return nodePosition(stimBank, "right_node");
}

function rebuildNode(stimBank: StimBank, nodeId: string, isHolder: boolean): StimSpec {
  return stimBank.rebuild(nodeId, {
    lineColor: isHolder ? "#ffd447" : "white"
  });
}

function readPlayerNames(settings: TaskSettings): PlayerNames {
  const configured =
    settings.player_names && typeof settings.player_names === "object"
      ? (settings.player_names as Record<string, unknown>)
      : {};
  return {
    participant: String(configured.participant ?? "You"),
    left: String(configured.left ?? "Player A"),
    right: String(configured.right ?? "Player B")
  };
}

function getOutcome(snapshot: TrialSnapshot): TossOutcome | null {
  const value = snapshot.units.decision_outcome?.outcome_payload;
  if (!value || typeof value !== "object") {
    return null;
  }
  return value as TossOutcome;
}

function outcomeFromSnapshot(snapshot: TrialSnapshot): TossOutcome {
  const outcome = getOutcome(snapshot);
  if (outcome) {
    return outcome;
  }
  return {
    from_player: PLAYER_LEFT,
    to_player: PLAYER_LEFT,
    from_player_id: "left",
    to_player_id: "left",
    from_player_name: "Player A",
    to_player_name: "Player A",
    participant_turn: false,
    avatar_turn: true,
    participant_response: "",
    participant_rt: null,
    participant_timed_out: false,
    participant_received: false
  };
}

export function run_trial(
  trial: TrialBuilder,
  condition: string,
  context: {
    settings: TaskSettings;
    stimBank: StimBank;
    controller: Controller;
    ball_state: { holder: number };
    block_id: string;
    block_idx: number;
    total_tosses: number;
  }
): TrialBuilder {
  const {
    settings,
    stimBank,
    controller,
    ball_state,
    block_id,
    block_idx,
    total_tosses
  } = context;
  const conditionLabel = normalizeCondition(condition);
  const playerNames = readPlayerNames(settings);
  const leftKey = normalizeKey(settings.left_key ?? "f");
  const rightKey = normalizeKey(settings.right_key ?? "j");
  const responseKeys = [leftKey, rightKey];
  const noResponsePolicy = String(settings.no_response_policy ?? "random");
  const triggerMap = (settings.triggers ?? {}) as Record<string, unknown>;

  const avatarDecisionSpec = settings.avatar_decision_delay ?? [0.8, 1.2];
  const avatarDeadline = maxDeadline(avatarDecisionSpec, 1.0);
  const participantTimeout = Math.max(0.1, Number(settings.participant_timeout ?? 2.5));
  const tossDuration = Math.max(0, Number(settings.toss_animation_duration ?? 0.45));
  const interTossInterval = Math.max(0, Number(settings.inter_toss_interval ?? 0.25));
  const trialIndex = Number(trial.trial_index) + 1;

  const statusStim = stimBank.get_and_format("status_line", {
    condition_name: titleCase(conditionLabel),
    toss_num: trialIndex,
    total_tosses: total_tosses
  });

  const setup = trial.unit("trial_setup");
  set_trial_context(setup, {
    trial_id: trial.trial_id,
    phase: "trial_setup",
    deadline_s: 0,
    valid_keys: [],
    block_id,
    condition_id: conditionLabel,
    task_factors: {
      stage: "trial_setup",
      condition: conditionLabel,
      block_idx
    },
    stim_id: "trial_setup"
  });
  setup.show({ duration: 0 }).set_state({
    holder_before: () => toPlayerId(ball_state.holder, PLAYER_LEFT)
  });

  const participantTurn = trial
    .unit("participant_turn")
    .addStim(rebuildNode(stimBank, "participant_node", true))
    .addStim(rebuildNode(stimBank, "left_node", false))
    .addStim(rebuildNode(stimBank, "right_node", false))
    .addStim(stimBank.get("participant_label"))
    .addStim(stimBank.get("left_label"))
    .addStim(stimBank.get("right_label"))
    .addStim(stimBank.rebuild("ball", { pos: ballPositionForPlayer(stimBank, PLAYER_PARTICIPANT) }))
    .addStim(statusStim)
    .addStim(stimBank.get("participant_prompt"));
  set_trial_context(participantTurn, {
    trial_id: trial.trial_id,
    phase: "participant_turn",
    deadline_s: participantTimeout,
    valid_keys: responseKeys,
    block_id,
    condition_id: conditionLabel,
    task_factors: {
      stage: "participant_turn",
      condition: conditionLabel,
      holder_before: "participant",
      participant_turn: true,
      left_key: leftKey,
      right_key: rightKey,
      block_idx
    },
    stim_id: "cyberball_scene+participant_prompt+status_line"
  });
  participantTurn
    .captureResponse({
      keys: responseKeys,
      duration: participantTimeout,
      response_trigger: {
        [leftKey]: Number(triggerMap.participant_choice_left ?? 31),
        [rightKey]: Number(triggerMap.participant_choice_right ?? 32)
      },
      timeout_trigger: Number(triggerMap.participant_timeout ?? 33)
    })
    .when(
      (snapshot: TrialSnapshot) =>
        Number(snapshot.units.trial_setup?.holder_before) === PLAYER_PARTICIPANT
    )
    .set_state({
      response_key: (snapshot: TrialSnapshot) =>
        normalizeKey(snapshot.units.participant_turn?.response),
      rt_s: (snapshot: TrialSnapshot) => {
        const rt = Number(snapshot.units.participant_turn?.rt);
        return Number.isFinite(rt) ? rt : null;
      }
    })
    .to_dict();

  const avatarTurn = trial
    .unit("avatar_turn")
    .addStim((snapshot: TrialSnapshot) => {
      const holder = toPlayerId(snapshot.units.trial_setup?.holder_before, PLAYER_LEFT);
      return rebuildNode(stimBank, "participant_node", holder === PLAYER_PARTICIPANT);
    })
    .addStim((snapshot: TrialSnapshot) => {
      const holder = toPlayerId(snapshot.units.trial_setup?.holder_before, PLAYER_LEFT);
      return rebuildNode(stimBank, "left_node", holder === PLAYER_LEFT);
    })
    .addStim((snapshot: TrialSnapshot) => {
      const holder = toPlayerId(snapshot.units.trial_setup?.holder_before, PLAYER_LEFT);
      return rebuildNode(stimBank, "right_node", holder === PLAYER_RIGHT);
    })
    .addStim(stimBank.get("participant_label"))
    .addStim(stimBank.get("left_label"))
    .addStim(stimBank.get("right_label"))
    .addStim((snapshot: TrialSnapshot) => {
      const holder = toPlayerId(snapshot.units.trial_setup?.holder_before, PLAYER_LEFT);
      return stimBank.rebuild("ball", { pos: ballPositionForPlayer(stimBank, holder) });
    })
    .addStim(statusStim)
    .addStim((snapshot: TrialSnapshot) => {
      const holder = toPlayerId(snapshot.units.trial_setup?.holder_before, PLAYER_LEFT);
      return stimBank.get_and_format("avatar_wait_prompt", {
        holder_name: playerName(holder, playerNames)
      });
    });
  set_trial_context(avatarTurn, {
    trial_id: trial.trial_id,
    phase: "avatar_turn",
    deadline_s: avatarDeadline,
    valid_keys: [],
    block_id,
    condition_id: conditionLabel,
    task_factors: {
      stage: "avatar_turn",
      condition: conditionLabel,
      participant_turn: false,
      block_idx
    },
    stim_id: "cyberball_scene+avatar_wait_prompt+status_line"
  });
  avatarTurn
    .show({
      duration: () => controller.sample_avatar_delay(avatarDecisionSpec)
    })
    .when(
      (snapshot: TrialSnapshot) =>
        Number(snapshot.units.trial_setup?.holder_before) !== PLAYER_PARTICIPANT
    )
    .to_dict();

  const decisionOutcome = trial.unit("decision_outcome");
  set_trial_context(decisionOutcome, {
    trial_id: trial.trial_id,
    phase: "decision_outcome",
    deadline_s: 0,
    valid_keys: [],
    block_id,
    condition_id: conditionLabel,
    task_factors: {
      stage: "decision_outcome",
      condition: conditionLabel,
      block_idx
    },
    stim_id: "decision_outcome"
  });
  decisionOutcome
    .show({ duration: 0 })
    .set_state({
      outcome_payload: (snapshot: TrialSnapshot) => {
        const fromPlayer = toPlayerId(snapshot.units.trial_setup?.holder_before, PLAYER_LEFT);
        const participantHasTurn = fromPlayer === PLAYER_PARTICIPANT;
        if (participantHasTurn) {
          const responseKey = normalizeKey(snapshot.units.participant_turn?.response_key);
          const rt = Number(snapshot.units.participant_turn?.rt_s);
          const participantRt = Number.isFinite(rt) ? rt : null;
          let toPlayer = PLAYER_LEFT;
          let participantResponse = "";
          let timedOut = false;
          if (responseKey === leftKey) {
            toPlayer = PLAYER_LEFT;
            participantResponse = leftKey;
          } else if (responseKey === rightKey) {
            toPlayer = PLAYER_RIGHT;
            participantResponse = rightKey;
          } else {
            timedOut = true;
            toPlayer = controller.fallback_participant_target(noResponsePolicy);
          }
          return {
            from_player: fromPlayer,
            to_player: toPlayer,
            from_player_id: playerKey(fromPlayer),
            to_player_id: playerKey(toPlayer),
            from_player_name: playerName(fromPlayer, playerNames),
            to_player_name: playerName(toPlayer, playerNames),
            participant_turn: true,
            avatar_turn: false,
            participant_response: participantResponse,
            participant_rt: participantRt,
            participant_timed_out: timedOut,
            participant_received: toPlayer === PLAYER_PARTICIPANT
          } satisfies TossOutcome;
        }

        const avatarTarget = controller.choose_avatar_target(fromPlayer, conditionLabel);
        return {
          from_player: fromPlayer,
          to_player: avatarTarget,
          from_player_id: playerKey(fromPlayer),
          to_player_id: playerKey(avatarTarget),
          from_player_name: playerName(fromPlayer, playerNames),
          to_player_name: playerName(avatarTarget, playerNames),
          participant_turn: false,
          avatar_turn: true,
          participant_response: "",
          participant_rt: null,
          participant_timed_out: false,
          participant_received: avatarTarget === PLAYER_PARTICIPANT
        } satisfies TossOutcome;
      }
    });

  const tossAnimation = trial
    .unit("toss_animation")
    .addStim((snapshot: TrialSnapshot) => {
      const outcome = outcomeFromSnapshot(snapshot);
      return rebuildNode(
        stimBank,
        "participant_node",
        outcome.from_player === PLAYER_PARTICIPANT
      );
    })
    .addStim((snapshot: TrialSnapshot) => {
      const outcome = outcomeFromSnapshot(snapshot);
      return rebuildNode(stimBank, "left_node", outcome.from_player === PLAYER_LEFT);
    })
    .addStim((snapshot: TrialSnapshot) => {
      const outcome = outcomeFromSnapshot(snapshot);
      return rebuildNode(stimBank, "right_node", outcome.from_player === PLAYER_RIGHT);
    })
    .addStim(stimBank.get("participant_label"))
    .addStim(stimBank.get("left_label"))
    .addStim(stimBank.get("right_label"))
    .addStim((snapshot: TrialSnapshot) => {
      const outcome = outcomeFromSnapshot(snapshot);
      return stimBank.rebuild("ball", { pos: ballPositionForPlayer(stimBank, outcome.to_player) });
    })
    .addStim(statusStim);
  set_trial_context(tossAnimation, {
    trial_id: trial.trial_id,
    phase: "toss_animation",
    deadline_s: tossDuration,
    valid_keys: [],
    block_id,
    condition_id: conditionLabel,
    task_factors: {
      stage: "toss_animation",
      condition: conditionLabel,
      block_idx
    },
    stim_id: "cyberball_scene+status_line"
  });
  tossAnimation.show({ duration: tossDuration }).to_dict();

  if (interTossInterval > 0) {
    const interToss = trial
      .unit("inter_toss")
      .addStim((snapshot: TrialSnapshot) => {
        const outcome = outcomeFromSnapshot(snapshot);
        return rebuildNode(
          stimBank,
          "participant_node",
          outcome.to_player === PLAYER_PARTICIPANT
        );
      })
      .addStim((snapshot: TrialSnapshot) => {
        const outcome = outcomeFromSnapshot(snapshot);
        return rebuildNode(stimBank, "left_node", outcome.to_player === PLAYER_LEFT);
      })
      .addStim((snapshot: TrialSnapshot) => {
        const outcome = outcomeFromSnapshot(snapshot);
        return rebuildNode(stimBank, "right_node", outcome.to_player === PLAYER_RIGHT);
      })
      .addStim(stimBank.get("participant_label"))
      .addStim(stimBank.get("left_label"))
      .addStim(stimBank.get("right_label"))
      .addStim((snapshot: TrialSnapshot) => {
        const outcome = outcomeFromSnapshot(snapshot);
        return stimBank.rebuild("ball", {
          pos: ballPositionForPlayer(stimBank, outcome.to_player)
        });
      })
      .addStim(statusStim);
    set_trial_context(interToss, {
      trial_id: trial.trial_id,
      phase: "inter_toss",
      deadline_s: interTossInterval,
      valid_keys: [],
      block_id,
      condition_id: conditionLabel,
      task_factors: {
        stage: "inter_toss",
        condition: conditionLabel,
        block_idx
      },
      stim_id: "cyberball_scene+status_line"
    });
    interToss.show({ duration: interTossInterval }).to_dict();
  }

  trial.finalize((snapshot, _runtime, helpers) => {
    const outcome = getOutcome(snapshot);
    if (!outcome) {
      return;
    }

    helpers.setTrialState("condition", conditionLabel);
    helpers.setTrialState("block_idx", block_idx);
    helpers.setTrialState("from_player", outcome.from_player);
    helpers.setTrialState("to_player", outcome.to_player);
    helpers.setTrialState("from_player_id", outcome.from_player_id);
    helpers.setTrialState("to_player_id", outcome.to_player_id);
    helpers.setTrialState("from_player_name", outcome.from_player_name);
    helpers.setTrialState("to_player_name", outcome.to_player_name);
    helpers.setTrialState("participant_turn", outcome.participant_turn);
    helpers.setTrialState("avatar_turn", outcome.avatar_turn);
    helpers.setTrialState("participant_response", outcome.participant_response);
    helpers.setTrialState("participant_rt", outcome.participant_rt);
    helpers.setTrialState("participant_timed_out", outcome.participant_timed_out);
    helpers.setTrialState("participant_received", outcome.participant_received);

    controller.record_toss({
      from_player: outcome.from_player,
      to_player: outcome.to_player
    });
    ball_state.holder = outcome.to_player;
  });

  return trial;
}
