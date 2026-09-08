mergeInto(LibraryManager.library, {
  MCACS_LoadFirstPlayer: function (gameObjectPtr) {
    var gameObjectName = UTF8ToString(gameObjectPtr);
    var query = new URLSearchParams(window.location.search);
    var apiBase = (query.get('apiBase') || '').replace(/\/$/, '');
    var token = query.get('token');
    var suffix = token ? '?token=' + encodeURIComponent(token) : '';
    fetch(apiBase + '/api/players' + suffix)
      .then(function (response) {
        if (!response.ok) throw new Error('player request failed: ' + response.status);
        return response.json();
      })
      .then(function (players) {
        if (!Array.isArray(players) || players.length === 0) throw new Error('no online player available');
        var player = players[0];
        SendMessage(gameObjectName, 'OnPlayerLoaded', JSON.stringify({
          playerId: String(player.playerId || player.id || ''),
          name: String(player.name || player.playerName || player.playerId || '')
        }));
      })
      .catch(function (error) {
        SendMessage(gameObjectName, 'OnBridgeError', error.message);
      });
  },

  MCACS_SubmitWarning: function (gameObjectPtr, playerIdPtr, reasonPtr) {
    var gameObjectName = UTF8ToString(gameObjectPtr);
    var playerId = UTF8ToString(playerIdPtr);
    var reason = UTF8ToString(reasonPtr);
    var query = new URLSearchParams(window.location.search);
    var apiBase = (query.get('apiBase') || '').replace(/\/$/, '');
    var token = query.get('token');
    var suffix = token ? '?token=' + encodeURIComponent(token) : '';
    var requestId = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Date.now() + '-' + Math.random().toString(16).slice(2);

    fetch(apiBase + '/api/v1/commands' + suffix, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestId: requestId,
        serverId: 'main-server',
        type: 'warning',
        playerId: playerId,
        reason: reason
      })
    })
      .then(function (response) {
        return response.json().then(function (body) {
          if (!response.ok) throw new Error(body.error || ('command request failed: ' + response.status));
          return body;
        });
      })
      .then(function (body) {
        SendMessage(gameObjectName, 'OnCommandResponse', JSON.stringify(body));
      })
      .catch(function (error) {
        SendMessage(gameObjectName, 'OnBridgeError', error.message);
      });
  },

  MCACS_GetCommand: function (gameObjectPtr, commandIdPtr) {
    var gameObjectName = UTF8ToString(gameObjectPtr);
    var commandId = UTF8ToString(commandIdPtr);
    var query = new URLSearchParams(window.location.search);
    var apiBase = (query.get('apiBase') || '').replace(/\/$/, '');
    var token = query.get('token');
    var suffix = token ? '?token=' + encodeURIComponent(token) : '';
    fetch(apiBase + '/api/v1/commands/' + encodeURIComponent(commandId) + suffix)
      .then(function (response) {
        if (!response.ok) throw new Error('command status failed: ' + response.status);
        return response.json();
      })
      .then(function (command) {
        SendMessage(gameObjectName, 'OnCommandResponse', JSON.stringify({ command: command, duplicate: false }));
      })
      .catch(function (error) {
        SendMessage(gameObjectName, 'OnBridgeError', error.message);
      });
  }
});
