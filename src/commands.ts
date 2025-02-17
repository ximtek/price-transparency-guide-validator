import util from 'util';
import path from 'path';
import { exec } from 'child_process';
import fs from 'fs-extra';
import readlineSync from 'readline-sync';
import { OptionValues } from 'commander';
import isUrl from 'is-url';

import {
  config,
  chooseJsonFile,

  getEntryFromZip,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  assessTocContents,
// eslint-disable-next-line @typescript-eslint/no-unused-vars
  assessReferencedProviders
} from './utils';
import temp from 'temp';
import { SchemaManager } from './SchemaManager';
import { DockerManager } from './DockerManager';
import { logger } from './logger';
import { DownloadManager } from './DownloadManager';

export async function validate(dataFile: string, options: OptionValues) {
  console.log('🔍 Received Input:', dataFile);
  console.log('📜 Validation Options:', options);

  let jsonData = null;

  try {
    // Check if the input is JSON (detect based on first character)
    if (dataFile.trim().startsWith('{')) {
      console.log('📥 Detected direct JSON input.');
      jsonData = JSON.parse(dataFile);
    } else if (fs.existsSync(dataFile)) {
      console.log('📂 Detected file path. Reading file...');
      jsonData = JSON.parse(fs.readFileSync(dataFile, 'utf-8'));
    } else {
      console.log('❌ ERROR: Data file not found or invalid input.');
      return { success: false, message: 'Data file not found or invalid input' };
    }
  } catch (error) {
    console.log('❌ ERROR: Invalid JSON input.', error.message);
    return { success: false, message: 'Invalid JSON format' };
  }

  // Pass jsonData to schema validation (modify SchemaManager as needed)
  return processJsonData(jsonData, options);
}

// Helper function to process JSON (modify as needed)
async function processJsonData(jsonData: any, options: OptionValues) {
  console.log('✅ Processing JSON Data:', jsonData);

  // Modify SchemaManager to accept JSON directly if needed
  const schemaManager = new SchemaManager();
  await schemaManager.ensureRepo();
  schemaManager.strict = options.strict;

  const versionToUse = options.schemaVersion || 'default-version';
  await schemaManager.useVersion(versionToUse);

  console.log('✅ Using Schema Version:', versionToUse);
  const schemaPath = await schemaManager.useSchema(options.target);

  if (!schemaPath) {
    return { success: false, message: 'Schema not found' };
  }

  const dockerManager = new DockerManager(options.out);
  const validationResult = await dockerManager.runContainerWithJson(schemaPath, options.target, jsonData);

  console.log('🚀 Validation Result:', validationResult);
  return validationResult;
}

export async function validateFromUrl(dataUrl: string, options: OptionValues) {
  console.log('🔗 Received URL:', dataUrl);
  console.log('📜 Validation Options:', options);

  temp.track();
  const downloadManager = new DownloadManager(options.yesAll);

  if (await downloadManager.checkDataUrl(dataUrl)) {
    const schemaManager = new SchemaManager();
    await schemaManager.ensureRepo();
    schemaManager.strict = options.strict;

    return schemaManager
      .useVersion(options.schemaVersion)
      .then(async (versionIsAvailable) => {
        if (!versionIsAvailable) {
          console.log('❌ ERROR: No schema available for URL validation!');
          return { success: false, message: 'No schema available' };
        }

        console.log('✅ Schema Version Available, Using:', options.schemaVersion);
        return schemaManager.useSchema(options.target);
      })
      .then(async (schemaPath) => {
        if (typeof schemaPath !== 'string') {
          console.log('❌ ERROR: Expected schemaPath to be a string but got:', schemaPath);
          return { success: false, message: 'Invalid schema path' };
        }

        console.log('✅ Using Schema:', schemaPath);
        const dockerManager = new DockerManager(options.out);
        const dataFile = await downloadManager.downloadDataFile(dataUrl);

        if (typeof dataFile === 'string') {
          const containerResult = await dockerManager.runContainer(schemaPath, options.target, dataFile);
          console.log('🚀 Validation Result:', containerResult);
          return containerResult;
        } else {
          console.log('🔍 Multiple files detected in ZIP. Prompting for selection...');
          let continuation = true;
          while (continuation) {
            const chosenEntry = chooseJsonFile(dataFile.jsonEntries);
            await getEntryFromZip(dataFile.zipFile, chosenEntry, dataFile.dataPath);
            await dockerManager.runContainer(schemaPath, options.target, dataFile.dataPath);
            continuation = readlineSync.keyInYNStrict('Would you like to validate another file in the ZIP?');
          }
          dataFile.zipFile.close();
        }
      })
      .catch((err) => {
        console.log('❌ ERROR: Exception in URL validation:', err);
        return { success: false, message: err.message };
      });
  } else {
    console.log('🚪 Exiting: Invalid or unreachable URL.');
    return { success: false, message: 'Invalid URL' };
  }
}

export async function update() {
  try {
    console.log('🔄 Updating Schema Repository...');

    if (!fs.existsSync(path.join(config.SCHEMA_REPO_FOLDER, '.git'))) {
      await util.promisify(exec)(
        `git clone ${config.SCHEMA_REPO_URL} '${config.SCHEMA_REPO_FOLDER}'`
      );
      console.log('📥 Retrieved schemas.');
    } else {
      await util.promisify(exec)(
        `git -C '${config.SCHEMA_REPO_FOLDER}' checkout master && git -C '${config.SCHEMA_REPO_FOLDER}' pull --no-rebase -t`
      );
      console.log('🔄 Updated schemas.');
    }
  } catch (error) {
    console.log('❌ ERROR: Failed to update schemas:', error);
    process.exitCode = 1;
  }
}
