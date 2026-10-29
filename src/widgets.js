// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
// The content is declarative (`value`, `status`, `card-list`, `button`...):
// the core renders it with its own theme and picks the user's language from
// the multi-language objects. Computed parts come from the last snapshot of
// the monitor (src/app.js), which nudges the widgets when it changes; the
// device-bound tile follows the published states live.
//
//   - node_red_status: is Node-RED up, which version, how many flows, the
//     editor port, and buttons to start / stop the flows or restart it;
//   - node_red_flows: the flow tabs with their enabled / disabled badge.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { MESSAGES, format } from './i18n.js';
import { FEATURES, instanceIds } from './devices.js';

const logger = createLogger({ name: 'widgets' });

export const STATUS_WIDGET = 'node_red_status';
export const FLOWS_WIDGET = 'node_red_flows';

const STATUS_ACTIONS = {
  START_FLOWS: 'start_flows',
  STOP_FLOWS: 'stop_flows',
  RESTART: 'restart',
};

// Content TTL: a safety net, the monitor nudges on every change.
const TTL_SECONDS = 120;
const MAX_FLOW_CARDS = 8;

function onlineStatus(online) {
  if (online) {
    return { value: MESSAGES.online, color: WIDGET_COLORS.SUCCESS };
  }
  if (online === false) {
    return { value: MESSAGES.offline, color: WIDGET_COLORS.DANGER };
  }
  return { value: MESSAGES.unknown, color: WIDGET_COLORS.NEUTRAL };
}

function firstLine(text, max) {
  const line = (text ?? '').split('\n').find((candidate) => candidate.trim() !== '') ?? '';
  return line.trim().slice(0, max);
}

export const WIDGETS = {
  [STATUS_WIDGET]: {
    async get(app) {
      logger.debug(`onWidgetGet <- ${STATUS_WIDGET}`);
      const { online, version, flowsRunning, tabs } = app.snapshot;
      const enabled = tabs.filter((tab) => !tab.disabled).length;
      const components = [
        {
          type: 'value',
          label: MESSAGES.flowsRunning,
          icon: 'play-circle',
          device_feature: instanceIds(app.gladys).feature(FEATURES.FLOWS_RUNNING),
        },
        {
          type: 'value',
          label: MESSAGES.flows,
          icon: 'git-branch',
          value: online ? `${enabled}/${tabs.length}` : '-',
        },
        {
          type: 'status',
          items: [
            { label: MESSAGES.status, icon: 'server', ...onlineStatus(online) },
            {
              label: MESSAGES.version,
              icon: 'tag',
              value: version ?? '-',
              color: WIDGET_COLORS.NEUTRAL,
            },
            {
              label: MESSAGES.editorPort,
              icon: 'external-link',
              value: app.hostPort ?? '-',
              color: WIDGET_COLORS.INFO,
            },
          ],
        },
      ];
      if (online) {
        components.push(
          flowsRunning === false
            ? {
                type: 'button',
                label: MESSAGES.startFlows,
                icon: 'play',
                style: 'primary',
                action: { key: STATUS_ACTIONS.START_FLOWS },
              }
            : {
                type: 'button',
                label: MESSAGES.stopFlows,
                icon: 'pause',
                style: 'secondary',
                action: { key: STATUS_ACTIONS.STOP_FLOWS, confirm: true },
              },
        );
      }
      components.push({
        type: 'button',
        label: MESSAGES.restart,
        icon: 'refresh-cw',
        style: 'danger',
        action: { key: STATUS_ACTIONS.RESTART, confirm: true },
      });
      return { ttl_seconds: TTL_SECONDS, components };
    },

    async action(app, actionKey) {
      logger.info(`onWidgetAction <- ${STATUS_WIDGET}.${actionKey}`);
      switch (actionKey) {
        case STATUS_ACTIONS.START_FLOWS:
          await app.setFlowsRunning(true);
          return MESSAGES.flowsStarted;
        case STATUS_ACTIONS.STOP_FLOWS:
          await app.setFlowsRunning(false);
          return MESSAGES.flowsStopped;
        case STATUS_ACTIONS.RESTART:
          await app.restart();
          return MESSAGES.restarted;
        default:
          throw new Error(`Unknown widget action: ${actionKey}`);
      }
    },
  },

  [FLOWS_WIDGET]: {
    async get(app) {
      logger.debug(`onWidgetGet <- ${FLOWS_WIDGET}`);
      const { online, tabs } = app.snapshot;
      if (!online) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'caption', text: MESSAGES.unreachable }],
        };
      }
      if (tabs.length === 0) {
        return {
          ttl_seconds: TTL_SECONDS,
          components: [{ type: 'text', variant: 'caption', text: MESSAGES.noFlow }],
        };
      }
      const enabled = tabs.filter((tab) => !tab.disabled).length;
      const components = [
        {
          type: 'text',
          variant: 'caption',
          text: format(
            (lang) =>
              `${MESSAGES.flows[lang]}: ${tabs.length} · ${MESSAGES.enabled[lang]}: ${enabled}`,
          ),
        },
        {
          type: 'card-list',
          display: 'list',
          items: tabs.slice(0, MAX_FLOW_CARDS).map((tab) => {
            const item = {
              title: tab.label.slice(0, 60),
              badge: tab.disabled
                ? { text: MESSAGES.disabled, color: WIDGET_COLORS.NEUTRAL }
                : { text: MESSAGES.enabled, color: WIDGET_COLORS.SUCCESS },
            };
            const subtitle = firstLine(tab.info, 80);
            if (subtitle) {
              item.subtitle = subtitle;
            }
            return item;
          }),
        },
      ];
      return { ttl_seconds: TTL_SECONDS, components };
    },
  },
};

/** Ask the core to re-pull every widget now (fire-and-forget, rate-limited). */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
