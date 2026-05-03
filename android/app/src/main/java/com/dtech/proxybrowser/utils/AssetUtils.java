package com.dtech.proxybrowser.utils;

import android.content.Context;
import android.content.res.AssetManager;
import android.util.Log;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class AssetUtils {
    private static final String TAG = "AssetUtils";

    public interface ExtractionListener {
        void onProgress(String message);
    }

    public static void copyAssetFolder(Context context, String assetPath, String targetPath) throws IOException {
        AssetManager assetManager = context.getAssets();
        String[] assets = assetManager.list(assetPath);
        if (assets == null) return;

        File targetDir = new File(targetPath);
        if (!targetDir.exists()) {
            targetDir.mkdirs();
        }

        for (String asset : assets) {
            String fullAssetPath = assetPath.isEmpty() ? asset : assetPath + "/" + asset;
            String fullTargetPath = targetPath + "/" + asset;

            String[] subAssets = assetManager.list(fullAssetPath);
            if (subAssets != null && subAssets.length > 0) {
                // It's a folder
                copyAssetFolder(context, fullAssetPath, fullTargetPath);
            } else {
                // It's a file
                copyAssetFile(context, fullAssetPath, fullTargetPath);
            }
        }
    }

    public static void copyAssetFile(Context context, String assetFilePath, String targetFilePath) throws IOException {
        Log.d(TAG, "Copying asset: " + assetFilePath + " to " + targetFilePath);
        try (InputStream in = context.getAssets().open(assetFilePath);
             OutputStream out = new FileOutputStream(targetFilePath)) {
            byte[] buffer = new byte[1024];
            int read;
            while ((read = in.read(buffer)) != -1) {
                out.write(buffer, 0, read);
            }
        }
    }

    public static void extractZipAsset(Context context, String zipAssetName, String targetPath, ExtractionListener listener) throws IOException {
        File targetDir = new File(targetPath);
        if (!targetDir.exists()) {
            targetDir.mkdirs();
        }

        File markerFile = new File(targetPath, ".extracted");
        if (markerFile.exists()) {
            Log.d(TAG, "Environment already extracted. Skipping.");
            if (listener != null) {
                listener.onProgress("Environment ready.");
            }
            return;
        }

        if (listener != null) {
            listener.onProgress("Extracting environment...");
        }

        try (InputStream is = context.getAssets().open(zipAssetName);
             ZipInputStream zis = new ZipInputStream(is)) {

            ZipEntry ze;
            byte[] buffer = new byte[8192];
            int count = 0;

            while ((ze = zis.getNextEntry()) != null) {
                String filename = ze.getName();
                File newFile = new File(targetPath, filename);

                if (ze.isDirectory()) {
                    newFile.mkdirs();
                } else {
                    File parent = newFile.getParentFile();
                    if (parent != null && !parent.exists()) {
                        parent.mkdirs();
                    }
                    try (FileOutputStream fos = new FileOutputStream(newFile)) {
                        int len;
                        while ((len = zis.read(buffer)) > 0) {
                            fos.write(buffer, 0, len);
                        }
                    }
                }
                zis.closeEntry();

                count++;
                if (count % 100 == 0 && listener != null) {
                    listener.onProgress("Extracted " + count + " files...");
                }
            }
        }

        // Create marker file
        try (FileOutputStream fos = new FileOutputStream(markerFile)) {
            fos.write("extracted".getBytes());
        }

        if (listener != null) {
            listener.onProgress("Extraction complete.");
        }
    }
}
