using System;
using System.Runtime.InteropServices;
using UnityEngine;

namespace Mcacs.UnityMvp
{
    public sealed class MvpBootstrap : MonoBehaviour
    {
        [Serializable]
        private sealed class PlayerSelection
        {
            public string playerId;
            public string name;
        }

        [Serializable]
        private sealed class CommandEnvelope
        {
            public AdminCommand command;
            public bool duplicate;
        }

        [Serializable]
        private sealed class AdminCommand
        {
            public string commandId;
            public string status;
            public string result;
        }

#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")]
        private static extern void MCACS_LoadFirstPlayer(string gameObjectName);

        [DllImport("__Internal")]
        private static extern void MCACS_SubmitWarning(string gameObjectName, string playerId, string reason);

        [DllImport("__Internal")]
        private static extern void MCACS_GetCommand(string gameObjectName, string commandId);
#endif

        private Transform player;
        private Transform terminal;
        private Camera sceneCamera;
        private string selectedPlayerId;
        private string selectedPlayerName = "waiting for server";
        private string commandId;
        private string commandStatus = "walk to the terminal and press E";
        private bool commandTerminal;
        private float nextPollAt;

        [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
        private static void EnsureBootstrap()
        {
            if (FindAnyObjectByType<MvpBootstrap>() != null) return;
            new GameObject("MCACS-MVP").AddComponent<MvpBootstrap>();
        }

        private void Start()
        {
            BuildWorld();
#if UNITY_WEBGL && !UNITY_EDITOR
            MCACS_LoadFirstPlayer(gameObject.name);
#else
            selectedPlayerName = "Web build required for live server access";
#endif
        }

        private void Update()
        {
            var movement = new Vector3(Input.GetAxisRaw("Horizontal"), 0f, Input.GetAxisRaw("Vertical"));
            if (movement.sqrMagnitude > 1f) movement.Normalize();
            player.position += movement * (4f * Time.deltaTime);

            var cameraTarget = player.position + new Vector3(0f, 7f, -8f);
            sceneCamera.transform.position = Vector3.Lerp(sceneCamera.transform.position, cameraTarget, 8f * Time.deltaTime);
            sceneCamera.transform.LookAt(player.position + Vector3.up);

            if (Vector3.Distance(player.position, terminal.position) < 2.4f && Input.GetKeyDown(KeyCode.E))
            {
                SubmitWarning();
            }

#if UNITY_WEBGL && !UNITY_EDITOR
            if (!string.IsNullOrEmpty(commandId) && !commandTerminal && Time.time >= nextPollAt)
            {
                nextPollAt = Time.time + 1f;
                MCACS_GetCommand(gameObject.name, commandId);
            }
#endif
        }

        private void SubmitWarning()
        {
            if (string.IsNullOrEmpty(selectedPlayerId))
            {
                commandStatus = "no online player available";
                return;
            }
#if UNITY_WEBGL && !UNITY_EDITOR
            commandId = null;
            commandTerminal = false;
            commandStatus = "submitting";
            MCACS_SubmitWarning(gameObject.name, selectedPlayerId, "MCACS Unity MVP terminal warning");
#else
            commandStatus = "live command is disabled in the Unity Editor";
#endif
        }

        public void OnPlayerLoaded(string json)
        {
            var selection = JsonUtility.FromJson<PlayerSelection>(json);
            selectedPlayerId = selection.playerId;
            selectedPlayerName = string.IsNullOrEmpty(selection.name) ? selection.playerId : selection.name;
        }

        public void OnBridgeError(string message)
        {
            commandStatus = message;
        }

        public void OnCommandResponse(string json)
        {
            var envelope = JsonUtility.FromJson<CommandEnvelope>(json);
            if (envelope == null || envelope.command == null)
            {
                commandStatus = "invalid command response";
                return;
            }
            commandId = envelope.command.commandId;
            commandStatus = envelope.command.status;
            commandTerminal = envelope.command.status == "succeeded"
                || envelope.command.status == "failed"
                || envelope.command.status == "unknown";
            if (!string.IsNullOrEmpty(envelope.command.result)) commandStatus += ": " + envelope.command.result;
        }

        private void OnGUI()
        {
            GUI.Box(new Rect(20, 20, 410, 122), "MCACS Unity command vertical slice");
            GUI.Label(new Rect(36, 50, 380, 24), "WASD: move    E near red terminal: send warning");
            GUI.Label(new Rect(36, 76, 380, 24), "Target: " + selectedPlayerName);
            GUI.Label(new Rect(36, 102, 380, 32), "Server result: " + commandStatus);

            if (Vector3.Distance(player.position, terminal.position) < 2.4f)
            {
                GUI.Box(new Rect(Screen.width / 2f - 145f, Screen.height - 90f, 290f, 44f), "Press E to submit a real server warning");
            }
        }

        private void BuildWorld()
        {
            RenderSettings.ambientLight = new Color(0.55f, 0.6f, 0.68f);
            CreatePrimitive(PrimitiveType.Plane, "Ground", Vector3.zero, new Vector3(2.2f, 1f, 2.2f), new Color(0.26f, 0.38f, 0.31f));
            player = CreatePrimitive(PrimitiveType.Capsule, "DutyOfficer", new Vector3(-4f, 1f, 0f), Vector3.one, new Color(0.82f, 0.67f, 0.43f)).transform;
            terminal = CreatePrimitive(PrimitiveType.Cube, "CommandTerminal", new Vector3(4f, 0.75f, 0f), new Vector3(1.5f, 1.5f, 1.5f), new Color(0.65f, 0.12f, 0.12f)).transform;

            var lightObject = new GameObject("Sun");
            var light = lightObject.AddComponent<Light>();
            light.type = LightType.Directional;
            light.intensity = 1.2f;
            lightObject.transform.rotation = Quaternion.Euler(48f, -35f, 0f);

            var cameraObject = new GameObject("Main Camera");
            cameraObject.tag = "MainCamera";
            sceneCamera = cameraObject.AddComponent<Camera>();
            sceneCamera.clearFlags = CameraClearFlags.SolidColor;
            sceneCamera.backgroundColor = new Color(0.08f, 0.11f, 0.16f);
            sceneCamera.transform.position = player.position + new Vector3(0f, 7f, -8f);
        }

        private static GameObject CreatePrimitive(PrimitiveType type, string objectName, Vector3 position, Vector3 scale, Color color)
        {
            var item = GameObject.CreatePrimitive(type);
            item.name = objectName;
            item.transform.position = position;
            item.transform.localScale = scale;
            var shader = Shader.Find("Unlit/Color");
            var material = new Material(shader);
            material.color = color;
            item.GetComponent<Renderer>().material = material;
            return item;
        }
    }
}
