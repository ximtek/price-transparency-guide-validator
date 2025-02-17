import util from 'util';
import path from 'path';
import { exec } from 'child_process';
import fs from 'fs-extra';
import readlineSync from 'readline-sync';
import { OptionValues } from 'commander';

import {
  config,
  chooseJsonFile,
  getEntryFromZip,
  assessTocContents,
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

  if (!fs.existsSync(dataFile)) {
    console.log('❌ ERROR: Data file not found:', dataFile);
    logger.error(`Could not find data file: ${dataFile}`);
    process.exitCode = 1;
    return { success: false, message: 'Data file not found' };
  }

  const schemaManager = new SchemaManager();
  await schemaManager.ensureRepo();
  schemaManager.strict = options.strict;
  schemaManager.shouldDetectVersion = options.schemaVersion == null;

  let versionToUse: string;
  try {
    const detectedVersion = await schemaManager.determineVersion(dataFile);
    console.log('📌 Detected Schema Version:', detectedVersion);

    if (!schemaManager.shouldDetectVersion && detectedVersion !== options.schemaVersion) {
      console.log(`⚠️ WARNING: Mismatched schema version! Using ${options.schemaVersion} instead.`);
    }

    versionToUse = schemaManager.shouldDetectVersion ? detectedVersion : options.schemaVersion;
  } catch {
    console.log('❌ ERROR: No schema version detected!');
    return { success: false, message: 'Schema version not found in input' };
  }

  return schemaManager
    .useVersion(versionToUse)
    .then(async (versionIsAvailable) => {
      if (!versionIsAvailable) {
        console.log('❌ ERROR: No schema available!');
        return { success: false, message: 'No schema available' };
      }

      console.log('✅ Schema Version Available, Using:', versionToUse);
      return schemaManager.useSchema(options.target);
    })
    .then(async (schemaPath) => {
      if (typeof schemaPath !== 'string') {
        console.log('❌ ERROR: Expected schemaPath to be a string but got:', schemaPath);
        return { success: false, message: 'Invalid schema path' };
      }

      console.log('✅ Using Schema:', schemaPath);
      const dockerManager = new DockerManager(options.out);
      const validationResult = await dockerManager.runContainer(schemaPath, options.target, dataFile);

      console.log('🚀 Validation Result:', validationResult);
      return validationResult;
    })
    .catch((err) => {
      console.log('❌ ERROR: Exception in validation:', err);
      return { success: false, message: err.message };
    });
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
