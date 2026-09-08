using System.IO;
using Mcacs.UnityMvp;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Mcacs.UnityMvp.Editor
{
    public static class BuildWeb
    {
        public static void Build()
        {
            Directory.CreateDirectory("Assets/Scenes");
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            new GameObject("MCACS-MVP").AddComponent<MvpBootstrap>();
            const string scenePath = "Assets/Scenes/Mvp.unity";
            EditorSceneManager.SaveScene(scene, scenePath);

            PlayerSettings.companyName = "MCACS";
            PlayerSettings.productName = "MCACS Unity MVP";
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Disabled;
            PlayerSettings.WebGL.decompressionFallback = false;

            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { scenePath },
                locationPathName = "Build/Web",
                target = BuildTarget.WebGL,
                options = BuildOptions.None,
            });

            if (report.summary.result != BuildResult.Succeeded)
            {
                throw new BuildFailedException("Unity Web build failed: " + report.summary.result);
            }
        }
    }
}
