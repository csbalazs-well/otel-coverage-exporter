import * as core from '@actions/core';
import * as github from '@actions/github';
import { glob } from 'glob';
import { parse, matchFile } from 'codeowners-utils';
import * as fs from 'fs';
import { DiagConsoleLogger, DiagLogLevel, diag, metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const SUMMARY_FILE_NAME = 'coverage-summary.json';

type Histrogram = {
  pct: any;
  total: any;
  covered: any;
  // skipped: any;
};

const histogram = {} as Histrogram;

interface Input {
  token: string;
  serviceName: string;
  coverageFolder: string;
  otelCollectorUrl: string;
  runnerRoot: string;
  codeOwnersTeamPrefix: string;
}

type Summary = {
  path: string;
  summary: any;
};

// move this inside the getOwnerTeam funtion ?
const codeOwners = parse(fs.readFileSync('CODEOWNERS', { encoding: 'utf8', flag: 'r' }));

export function getOwnerTeam(path: string, codeOwnersTeamPrefix :string) {
  if (path !== '') {
    const entry = matchFile(path, codeOwners);
    if (entry) {
      const team = entry.owners.find((e) => e.startsWith(codeOwnersTeamPrefix));

      if (team) {
        return team.replace(codeOwnersTeamPrefix, '');
      }
    }
  }

  return 'UNOWNED';
}


export function getCoverageSummaries(coverageFolder :string): Summary[] {
  const files = glob.sync(coverageFolder + '**/' + SUMMARY_FILE_NAME, {});
  const summaries = new Array<Summary>;

  if (files.length === 0) {
    console.error('No summary files found.');
  } else {
    files.forEach((path) => {
      const summary = JSON.parse(fs.readFileSync('./' + path, 'utf-8'));
      if (hasCoverageData(summary)) {
        summaries.push({ summary, path });
      } else {
        console.log(`File ${path} has no test coverage data`);
      }
    });
  }

  return summaries;
}

function hasCoverageData(summary) {
  return summary.total.lines.pct !== 'Unknown';
}

export function initExporter(serviceName: string, otelCollectorUrl: string): void {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ALL);

  const meterProvider = new MeterProvider({
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: otelCollectorUrl,
        }),
        exportIntervalMillis: 1000,
      }),
    ],
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
    }),
  });
  metrics.setGlobalMeterProvider(meterProvider);

  const meter = meterProvider.getMeter('test_coverage');

  histogram.pct = meter.createHistogram('test_coverage_percentage', {
    description: 'Code coverage - percentage code covered',
  });
  histogram.total = meter.createHistogram('test_coverage_total', {
    description: 'Code coverage - total lines of code',
  });
  histogram.covered = meter.createHistogram('test_coverage_covered', {
    description: 'Code coverage - covered lines of code',
  });
  // histograms.skipped = meter.createHistogram('test_coverage_skipped', {
  //   description: 'Code coverage - skipped lines of code',
  // });
}

export function recordAllCoverages(summary: any, runnerRoot: string, codeOwnersTeamPrefix: string) {
  Object.keys(summary).forEach((key) => {
    if (key !== 'total') {
      const path = key.replace(runnerRoot, '');
      recordCoveragesForPath(summary[key], {
        coverage_path: path,
        owner_team: getOwnerTeam(path, codeOwnersTeamPrefix),
        application_name: getApplicationName(path),
      });
    }
  });
}

export function shutdownExporter() {
  const meterProvider = metrics.getMeterProvider() as MeterProvider;
  meterProvider.forceFlush().then(() => { 
    console.log('Meter provider flushed');
    meterProvider.shutdown().then(() => {
      console.log('Meter provider shut down');
    });
  });
}
function recordSingle(value, attributes) {
  Object.keys(histogram).forEach((key) => {
    histogram[key].record(value[key], attributes);
  });
}

function recordCoveragesForPath(coverages, attributes) {
  recordSingle(coverages.lines, { ...attributes, coverage_type: 'lines' });
  recordSingle(coverages.statements, { ...attributes, coverage_type: 'statements' });
  recordSingle(coverages.functions, { ...attributes, coverage_type: 'functions' });
  recordSingle(coverages.branches, { ...attributes, coverage_type: 'branches' });
}

function getApplicationName(path) {
  if (path != '') {
    let pathWithoutApps = path.indexOf('apps/') !== -1 ? path.replace('apps/', '') : path;
    return pathWithoutApps.split('/')[0];
  } else {
    return null;
  }
}


// --------------------------------------- Action ----------------------------------------
// ---------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------

export function getInputs(): Input {    
    const result = {} as Input;
    result.token = core.getInput('github-token');
    result.serviceName = core.getInput('service-name');
    result.coverageFolder = core.getInput('coverage-folder')
    result.otelCollectorUrl = core.getInput('otel-collector-url');
    result.runnerRoot = core.getInput('runner-root');
    result.codeOwnersTeamPrefix = core.getInput('codeowners-team-prefix');
    return result;
  }

  export const runAction = async (input: Input): Promise<void> => {
    initExporter(input.serviceName, input.otelCollectorUrl);
    console.log('Meter provider created, recording coverage');

    const summaries = getCoverageSummaries(input.coverageFolder);

    summaries.forEach((summary) => {
      console.log(`Processing file. Path: ${summary.path}`);
      recordAllCoverages(summary.summary, input.runnerRoot, input.codeOwnersTeamPrefix);
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