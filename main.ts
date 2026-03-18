import {
  StimBank,
  SubInfo,
  TaskSettings,
  TrialBuilder,
  count_down,
  mountTaskApp,
  next_trial_id,
  parsePsyflowConfig,
  reset_trial_counter,
  type CompiledTrial,
  type Resolvable,
  type RuntimeView,
  type StimRef,
  type StimSpec,
  type TrialSnapshot
} from "psyflow-web";

import configText from "./config/config.yaml?raw";
import { Controller, PLAYER_LEFT } from "./src/controller";
import { run_trial } from "./src/run_trial";
import { summarizeBlock, summarizeOverall } from "./src/utils";

const instructionVoiceAsset = new URL("./assets/instruction_text_voice.mp3", import.meta.url).href;

function buildWaitTrial(
  meta: { trial_id: string; condition: string; trial_index: number },
  blockId: string | null,
  unitLabel: string,
  stimInputs: Array<Resolvable<StimRef | StimSpec | null>>
): CompiledTrial {
  const trial = new TrialBuilder({
    trial_id: meta.trial_id,
    block_id: blockId,
    trial_index: meta.trial_index,
    condition: meta.condition
  });
  trial.unit(unitLabel).addStim(...stimInputs).waitAndContinue();
  return trial.build();
}

function normalizeConditionLabel(condition: string): string {
  const value = String(condition ?? "").trim().toLowerCase();
  return value.length > 0 ? value : "inclusion";
}

function toTitleCase(token: string): string {
  const value = normalizeConditionLabel(token);
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function resolveTrialPerBlock(settings: TaskSettings): number {
  const configured = Number(settings.trial_per_block ?? settings.trials_per_block ?? 0);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.max(1, Math.trunc(configured));
  }
  const totalBlocks = Math.max(1, Number(settings.total_blocks ?? 1));
  const totalTrials = Math.max(1, Number(settings.total_trials ?? totalBlocks));
  return Math.max(1, Math.floor(totalTrials / totalBlocks));
}

export async function run(root: HTMLElement): Promise<void> {
  const parsed = parsePsyflowConfig(configText, import.meta.url);
  const settings = TaskSettings.from_dict(parsed.task_config);
  const subInfo = new SubInfo(parsed.subform_config);
  const stimBank = new StimBank(parsed.stim_config);
  const controller = Controller.from_dict(parsed.controller_config);

  settings.triggers = parsed.trigger_config;
  settings.controller = parsed.controller_config;

  if (settings.voice_enabled) {
    stimBank.convert_to_voice("instruction_text", {
      voice: String(settings.voice_name ?? "en-US-AriaNeural"),
      rate: 1,
      assetFiles: {
        instruction_text: instructionVoiceAsset
      },
      fallbackToSpeech: false
    });
  }

  await mountTaskApp({
    root,
    task_id: "H000034-cyberball",
    task_name: "Cyberball Task",
    task_description:
      "HTML preview aligned to local psyflow Cyberball procedure and parameters.",
    settings,
    subInfo,
    stimBank,
    buildTrials: (): CompiledTrial[] => {
      reset_trial_counter();

      const compiledTrials: CompiledTrial[] = [];
      const totalBlocks = Math.max(1, Number(settings.total_blocks ?? 1));
      const trialPerBlock = resolveTrialPerBlock(settings);
      const conditionPool = Array.isArray(settings.conditions)
        ? settings.conditions.map((value) => normalizeConditionLabel(String(value)))
        : [];
      const conditions = conditionPool.length > 0 ? conditionPool : ["inclusion", "exclusion"];

      const instructionInputs: Array<Resolvable<StimRef | StimSpec | null>> = [
        stimBank.get("instruction_text")
      ];
      if (settings.voice_enabled) {
        instructionInputs.push(stimBank.get("instruction_text_voice"));
      }
      compiledTrials.push(
        buildWaitTrial(
          { trial_id: "instruction", condition: "instruction", trial_index: -1 },
          null,
          "instruction_text",
          instructionInputs
        )
      );

      for (let blockIndex = 0; blockIndex < totalBlocks; blockIndex += 1) {
        const blockId = `block_${blockIndex}`;
        const condition = conditions[blockIndex % conditions.length];
        controller.start_block(blockIndex, condition);
        const ballState = { holder: PLAYER_LEFT };

        compiledTrials.push(
          ...count_down({
            seconds: 3,
            block_id: blockId,
            trial_id_prefix: `countdown_${blockId}`,
            stim: { color: "white", height: 3.5 }
          })
        );

        for (let trialIndex = 0; trialIndex < trialPerBlock; trialIndex += 1) {
          const trial = new TrialBuilder({
            trial_id: next_trial_id(),
            block_id: blockId,
            trial_index: trialIndex,
            condition
          });
          run_trial(trial, condition, {
            settings,
            stimBank,
            controller,
            ball_state: ballState,
            block_id: blockId,
            block_idx: blockIndex,
            total_tosses: trialPerBlock
          });
          compiledTrials.push(trial.build());
        }

        if (blockIndex < totalBlocks - 1) {
          compiledTrials.push(
            buildWaitTrial(
              {
                trial_id: `block_break_${blockIndex}`,
                condition: "block_break",
                trial_index: trialPerBlock + blockIndex
              },
              blockId,
              "block_break",
              [
                (_snapshot: TrialSnapshot, runtime: RuntimeView) => {
                  const summary = summarizeBlock(runtime.getReducedRows(), blockId);
                  return stimBank.get_and_format("block_break", {
                    block_num: blockIndex + 1,
                    total_blocks: totalBlocks,
                    condition_name: toTitleCase(condition),
                    participant_receives: summary.participant_receives,
                    participant_turns: summary.participant_turns
                  });
                }
              ]
            )
          );
        }
      }

      compiledTrials.push(
        buildWaitTrial(
          {
            trial_id: "goodbye",
            condition: "goodbye",
            trial_index: Number(settings.total_trials ?? 0)
          },
          null,
          "goodbye",
          [
            (_snapshot: TrialSnapshot, runtime: RuntimeView) => {
              const summary = summarizeOverall(runtime.getReducedRows());
              return stimBank.get_and_format("good_bye", {
                participant_receives_total: summary.participant_receives,
                participant_turns_total: summary.participant_turns,
                total_tosses: summary.total_tosses
              });
            }
          ]
        )
      );

      return compiledTrials;
    }
  });
}

export async function main(root: HTMLElement): Promise<void> {
  await run(root);
}

export default main;

