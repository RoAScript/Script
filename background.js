const sidePanelPorts = new Set();
const lastSnapshotsByTabId = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('[Calcium][background] sidePanel behavior error:', error));
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error('[Calcium][background] sidePanel behavior error:', error));
});

chrome.tabs.onRemoved.addListener((tabId) => {
  lastSnapshotsByTabId.delete(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'loading') {
    lastSnapshotsByTabId.delete(tabId);
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'calcium-sidepanel') return;

  sidePanelPorts.add(port);

  port.onDisconnect.addListener(() => {
    sidePanelPorts.delete(port);
  });

  port.onMessage.addListener(async (message) => {
    if (message?.type === 'CALCIUM_PANEL_READY') {
      port.postMessage({
        type: 'CALCIUM_PANEL_READY_ACK'
      });
    }
  });
});

function broadcastToSidePanels(payload) {
  for (const port of sidePanelPorts) {
    try {
      port.postMessage(payload);
    } catch (error) {
      console.error('[Calcium][background] broadcast error:', error);
    }
  }
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });
  return tabs?.[0] || null;
}

function forwardToActiveTab(payload, sendResponse) {
  getActiveTab()
    .then((activeTab) => {
      if (!activeTab?.id) {
        sendResponse({ ok: false, error: 'NO_ACTIVE_TAB' });
        return;
      }

      chrome.tabs.sendMessage(activeTab.id, payload, (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({
            ok: false,
            error: chrome.runtime.lastError.message
          });
          return;
        }

        sendResponse(response || { ok: false, error: 'NO_RESPONSE' });
      });
    })
    .catch((error) => {
      sendResponse({
        ok: false,
        error: error?.message || String(error)
      });
    });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'CALCIUM_GET_ACTIVE_TAB_STATE') {
    getActiveTab()
      .then((activeTab) => {
        if (!activeTab?.id) {
          sendResponse({ ok: false, error: 'NO_ACTIVE_TAB' });
          return;
        }

        const cachedSnapshot = lastSnapshotsByTabId.get(activeTab.id);
        if (cachedSnapshot) {
          sendResponse({ ok: true, snapshot: cachedSnapshot, source: 'cache' });
          return;
        }

        chrome.tabs.sendMessage(activeTab.id, { type: 'CALCIUM_GET_STATE' }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              ok: false,
              error: chrome.runtime.lastError.message
            });
            return;
          }

          if (response?.ok && response?.snapshot) {
            lastSnapshotsByTabId.set(activeTab.id, response.snapshot);
          }

          sendResponse(response || { ok: false, error: 'NO_RESPONSE' });
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || String(error)
        });
      });

    return true;
  }

  if (message?.type === 'CALCIUM_REFRESH_TOKEN') {
    forwardToActiveTab({ type: 'CALCIUM_REFRESH_TOKEN' }, sendResponse);
    return true;
  }

  if (message?.type === 'CALCIUM_SET_FILTER_ON_ACTIVE_TAB') {
    forwardToActiveTab({
      type: 'CALCIUM_SET_FILTER',
      filter: message.filter
    }, sendResponse);
    return true;
  }

  if (message?.type === 'CALCIUM_SET_SEARCH_TEXT_ON_ACTIVE_TAB') {
    forwardToActiveTab({
      type: 'CALCIUM_SET_SEARCH_TEXT',
      text: message.text
    }, sendResponse);
    return true;
  }

  if (message?.type === 'CALCIUM_STATE_UPDATED') {
    const tabId = sender?.tab?.id;

    if (tabId != null && message.snapshot) {
      lastSnapshotsByTabId.set(tabId, message.snapshot);
      console.log('[Calcium][background] Snapshot mis en cache pour tabId =', tabId);
    }

    broadcastToSidePanels({
      type: 'CALCIUM_STATE_UPDATED',
      snapshot: message.snapshot,
      reason: message.reason || 'unknown',
      tabId: tabId ?? null
    });

    sendResponse({ ok: true });
    return false;
  }
});