const _ = require('lodash');
const axios = require('axios');
const bluebird = require('bluebird');
const moment = require('moment');
const yargs = require('yargs');
const {
  togglAPIToken,
  togglBaseURL,
  tempoAPIToken,
  tempoBaseURL,
  tempoUserName,
  tagIssueMapping,
} = require('./config');
const cache = require('./cache');

const basicAuthToken = Buffer.from(`${togglAPIToken}:api_token`).toString('base64');
const togglClient = axios.create({
  baseURL: togglBaseURL,
  headers: {
    Authorization: `Basic ${basicAuthToken}`,
  },
});

const tempoClient = axios.create({
  baseURL: tempoBaseURL,
  headers: {
    Authorization: `Bearer ${tempoAPIToken}`,
  },
});

const transferFromTogglToTempo = async (from, to) => {
  // get time entries from toggl
  const startDate = encodeURIComponent(`${from}T00:00:00+04:00`);
  const endDate = encodeURIComponent(`${to}T23:59:59+04:00`);
  const { data: timeEntries } = await togglClient
    .get(`time_entries?start_date=${startDate}&end_date=${endDate}`);

  console.log('number of time entries from toggl', timeEntries.length);

  // find all the unique task ids
  const uniqueTaskIds = _(timeEntries)
    .map(({ tid }) => tid)
    .filter(Boolean)
    .uniq()
    .value();

  console.log('number of unique task ids', uniqueTaskIds.length);

  // fetch task details for each task id
  const tasks = await bluebird.map(uniqueTaskIds, taskId =>
    cache.execute('getTaskDetails', `getTaskDetails::${taskId}`, async () => {
      const { data: task } = await togglClient.get(`tasks/${taskId}`);
      return task.data;
    }));
  const tasksById = _.groupBy(tasks, ({ id }) => id);

  console.log('fetch task details from toggl');

  // fetch worklogs
  const { data: { results: worklogs } } = await tempoClient.get('/worklogs', {
    params: {
      from,
      to,
      limit: 1000,
    },
  });

  const myWorkLogs = worklogs.filter(({ author }) =>
    author.username === tempoUserName);

  console.log('number of worklogs in tempo', myWorkLogs.length);

  // delete all the worklogs
  await bluebird.map(myWorkLogs, ({ tempoWorklogId }) =>
    tempoClient.delete(`/worklogs/${tempoWorklogId}`));

  console.log('deleted all worklogs in tempo');

  // compute JIRA issueKey from tags & taskId
  const validTimeEntries = timeEntries
    .map((timeEntry) => {
      const { tid, tags = [] } = timeEntry;

      if (tid) {
        return {
          ...timeEntry,
          issueKey: tasksById[tid][0].name,
        };
      }

      return {
        ...timeEntry,
        issueKey: _.get(tagIssueMapping.find(({ tag }) => tags.includes(tag)), 'issueKey'),
      };
    })
    .filter(({ issueKey }) => Boolean(issueKey));

  // create worklogs in tempo from toggl time entries
  await bluebird.map(
    validTimeEntries,
    async ({
      issueKey,
      description,
      start,
      duration,
      tags = [],
    }) => (
      tempoClient.post('worklogs/', {
        issueKey,
        timeSpentSeconds: duration,
        billableSeconds: duration,
        startDate: moment(start).format('YYYY-MM-DD'),
        startTime: moment(start).format('HH:mm:ss'),
        description: tags.concat(description).join(' '),
        authorUsername: tempoUserName,
      })),
  );

  console.log('number of worklogs added to temp', validTimeEntries.length);
};

const from = yargs.argv.from || moment().format('YYYY-MM-DD');
const { to } = yargs.argv;

transferFromTogglToTempo(from, to || from);
