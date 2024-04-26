import * as core from '@actions/core';
import * as github from '@actions/github';
import * as glob from "@actions/glob";
import { readFileSync } from 'fs';

interface Input {
  token: string;
  serviceName: string;
  coverageFolder: string;
}

// this is probably not needed
type TestType = 'unit' | 'integration' | 'e2e';

type Summary = {
  path: string;
  summary: any;
  testType: string;
};


export function initExporter(serviceName: string): void {}

export function getCoverageSummaries(coverageFolder: string): Summary[] {return []}

export function recordAllCoverages(summary: any, testType: string): void {}

export function shutdownExporter(): void {} 

export function getInputs(): Input {    
    const result = {} as Input;
    result.token = core.getInput('github-token');
    result.serviceName = core.getInput('service-name');
    result.coverageFolder = core.getInput('coverage-folder')
    return result;
  }

  export const runAction = async (input: Input): Promise<void> => {
    console.log('hello from csabi action')

    initExporter(input.serviceName);
    console.log('Meter provider created, recording coverage');

    const summaries = getCoverageSummaries(input.coverageFolder);

    summaries.forEach((summary) => {
      console.log(`Processing file. Path: ${summary.path}`);
      recordAllCoverages(summary.summary, summary.testType);
    });

    console.log('Coverage recorded');

    shutdownExporter();

}


const run = async (): Promise<void> => {
    try {
      const input = getInputs();
      return runAction(input);
    } catch (error) {
      core.startGroup(error instanceof Error ? error.message : JSON.stringify(error));
      core.info(JSON.stringify(error, null, 2));
      core.endGroup();
    }
  };
  
  export default run;