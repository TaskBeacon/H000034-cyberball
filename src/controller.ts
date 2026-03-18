export const PLAYER_PARTICIPANT = 0;
export const PLAYER_LEFT = 1;
export const PLAYER_RIGHT = 2;

function makeSeededRandom(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function toFiniteNumber(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class Controller {
  readonly inclusion_receive_prob: number;
  readonly exclusion_initial_receives: number;
  readonly random_seed: number | null;
  readonly enable_logging: boolean;
  private readonly random: () => number;
  toss_count_total: number;
  participant_received_total: number;
  block_idx: number;
  block_condition: string;
  toss_count_block: number;
  participant_received_block: number;

  constructor(args: {
    inclusion_receive_prob?: unknown;
    exclusion_initial_receives?: unknown;
    random_seed?: unknown;
    enable_logging?: unknown;
  }) {
    this.inclusion_receive_prob = Math.max(
      0,
      Math.min(1, toFiniteNumber(args.inclusion_receive_prob, 0.33))
    );
    this.exclusion_initial_receives = Math.max(
      0,
      Math.trunc(toFiniteNumber(args.exclusion_initial_receives, 2))
    );
    this.random_seed =
      args.random_seed == null || Number.isNaN(Number(args.random_seed))
        ? null
        : Math.trunc(Number(args.random_seed));
    this.enable_logging = args.enable_logging !== false;
    this.random = makeSeededRandom(this.random_seed ?? Math.floor(Date.now() % 2147483647));

    this.toss_count_total = 0;
    this.participant_received_total = 0;
    this.block_idx = -1;
    this.block_condition = "";
    this.toss_count_block = 0;
    this.participant_received_block = 0;
  }

  static from_dict(config: Record<string, unknown>): Controller {
    const cfg = config ?? {};
    return new Controller({
      inclusion_receive_prob:
        cfg.inclusion_receive_prob ?? cfg.inclusion_ratio ?? 0.33,
      exclusion_initial_receives:
        cfg.exclusion_initial_receives ?? cfg.exclusion_after_tosses ?? 2,
      random_seed: cfg.random_seed ?? null,
      enable_logging: cfg.enable_logging ?? true
    });
  }

  start_block(block_idx: number, condition: string): void {
    this.block_idx = Math.trunc(block_idx);
    this.block_condition = String(condition ?? "");
    this.toss_count_block = 0;
    this.participant_received_block = 0;
  }

  next_trial_id(): number {
    return this.toss_count_total + 1;
  }

  sample_avatar_delay(avatar_delay_range: unknown): number {
    if (typeof avatar_delay_range === "number" && Number.isFinite(avatar_delay_range)) {
      return Math.max(0, avatar_delay_range);
    }
    if (Array.isArray(avatar_delay_range) && avatar_delay_range.length >= 2) {
      const a = toFiniteNumber(avatar_delay_range[0], 1);
      const b = toFiniteNumber(avatar_delay_range[1], 1);
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      return Math.max(0, low + (high - low) * this.random());
    }
    return 1;
  }

  choose_avatar_target(current_holder: number, condition: string): number {
    if (current_holder !== PLAYER_LEFT && current_holder !== PLAYER_RIGHT) {
      throw new Error(`Avatar toss requested from invalid holder: ${current_holder}`);
    }
    const otherAvatar = current_holder === PLAYER_LEFT ? PLAYER_RIGHT : PLAYER_LEFT;
    const normalizedCondition = String(condition ?? "").trim().toLowerCase();

    if (normalizedCondition === "exclusion") {
      if (this.participant_received_block < this.exclusion_initial_receives) {
        return PLAYER_PARTICIPANT;
      }
      return otherAvatar;
    }

    if (this.random() < this.inclusion_receive_prob) {
      return PLAYER_PARTICIPANT;
    }
    return otherAvatar;
  }

  fallback_participant_target(no_response_policy = "random"): number {
    const policy = String(no_response_policy ?? "random").trim().toLowerCase();
    if (policy === "left") {
      return PLAYER_LEFT;
    }
    if (policy === "right") {
      return PLAYER_RIGHT;
    }
    return this.random() < 0.5 ? PLAYER_LEFT : PLAYER_RIGHT;
  }

  record_toss(args: { from_player: number; to_player: number }): void {
    this.toss_count_total += 1;
    this.toss_count_block += 1;
    if (args.to_player === PLAYER_PARTICIPANT) {
      this.participant_received_total += 1;
      this.participant_received_block += 1;
    }

    if (this.enable_logging) {
      console.debug(
        [
          "[Cyberball]",
          `block=${this.block_idx}`,
          `toss_block=${this.toss_count_block}`,
          `toss_total=${this.toss_count_total}`,
          `from=${args.from_player}`,
          `to=${args.to_player}`,
          `condition=${this.block_condition}`
        ].join(" ")
      );
    }
  }
}

