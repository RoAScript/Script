const sidePanelPorts = new Set();

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
    forwardToActiveTab({ type: 'CALCIUM_GET_STATE' }, sendResponse);
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
    broadcastToSidePanels({
      type: 'CALCIUM_STATE_UPDATED',
      snapshot: message.snapshot,
      reason: message.reason || 'unknown'
    });

    sendResponse({ ok: true });
    return false;
  }
});