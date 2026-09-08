using System.IO;
using Mcacs.UnityMvp;
using UnityEditor;
using UnityEditor.Build;
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
            IncludeRuntimeShader("Unlit/Color");

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

        private static void IncludeRuntimeShader(string shaderName)
        {
            var shader = Shader.Find(shaderName);
            if (shader == null) throw new BuildFailedException("Required shader not found: " + shaderName);

            var settings = AssetDatabase.LoadAllAssetsAtPath("ProjectSettings/GraphicsSettings.asset")[0];
            var serializedSettings = new SerializedObject(settings);
            var shaders = serializedSettings.FindProperty("m_AlwaysIncludedShaders");
            for (var index = 0; index < shaders.arraySize; index++)
            {
                if (shaders.GetArrayElementAtIndex(index).objectReferenceValue == shader) return;
            }

            shaders.InsertArrayElementAtIndex(shaders.arraySize);
            shaders.GetArrayElementAtIndex(shaders.arraySize - 1).objectReferenceValue = shader;
            serializedSettings.ApplyModifiedPropertiesWithoutUndo();
        }
    }
}
