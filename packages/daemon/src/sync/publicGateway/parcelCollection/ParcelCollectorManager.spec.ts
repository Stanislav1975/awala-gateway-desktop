import pipe from 'it-pipe';
import { PassThrough } from 'stream';
import { Container } from 'typedi';

import { asyncIterableToArray, iterableTake } from '../../../testUtils/iterables';
import { mockSpy } from '../../../testUtils/jest';
import { mockLoggerToken, partialPinoLog } from '../../../testUtils/logging';
import { makeStubPassThrough } from '../../../testUtils/stream';
import { setImmediateAsync } from '../../../testUtils/timing';
import { LOGGER } from '../../../tokens';
import * as child from '../../../utils/subprocess/child';
import { PublicGatewayCollectionStatus } from '../PublicGatewayCollectionStatus';
import { ParcelCollectorManager } from './ParcelCollectorManager';

const getSubprocessStream = makeStubPassThrough();
const mockFork = mockSpy(jest.spyOn(child, 'fork'), getSubprocessStream);

const mockLogs = mockLoggerToken();

let manager: ParcelCollectorManager;
beforeEach(() => {
  manager = new ParcelCollectorManager(Container.get(LOGGER));
});

describe('start', () => {
  test('Subprocess parcel-collection should be started', () => {
    manager.start();

    expect(mockFork).toBeCalledWith('parcel-collection');
    expect(mockLogs).toContainEqual(partialPinoLog('info', 'Started parcel collection subprocess'));
  });

  test('Subprocess should not be started if it is already running', () => {
    manager.start();
    manager.start();

    expect(mockFork).toBeCalledTimes(1);
    expect(mockLogs).toContainEqual(
      partialPinoLog('warn', 'Ignored attempt to start parcel collection subprocess a second time'),
    );
  });
});

describe('restart', () => {
  test('Process should be killed and then started if it is already running', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess2);
    manager.start();

    await manager.restart();

    expect(mockFork).toBeCalledTimes(2);
    expect(subprocess1.destroyed).toBeTrue();
    expect(subprocess2.destroyed).toBeFalse();
  });

  test('Nothing should happen if subprocess was not already running', async () => {
    const startSpy = jest.spyOn(manager, 'start');

    await manager.restart();

    expect(startSpy).not.toBeCalled();
  });

  test('Nothing should happen if subprocess is undergoing a restart', async () => {
    manager.start();

    // Mimic a restart
    getSubprocessStream().destroy();
    await setImmediateAsync();

    await manager.restart();

    expect(mockFork).toBeCalledTimes(1);
  });
});

describe('streamStatus', () => {
  test('It should wait for subprocess to start if it is not already running', async () => {
    setImmediate(async () => {
      manager.start();
      getSubprocessStream().write({ type: 'status', status: 'disconnected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.DISCONNECTED]);
  });

  test('DISCONNECTED should be returned if subprocess reports disconnection', async () => {
    manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'status', status: 'disconnected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.DISCONNECTED]);
  });

  test('CONNECTED should be returned if subprocess reports connection', async () => {
    manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });

  test('Subsequent connection changes should be reflected', async () => {
    manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'status', status: 'connected' });
      getSubprocessStream().write({ type: 'status', status: 'disconnected' });
      getSubprocessStream().write({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(3), asyncIterableToArray),
    ).resolves.toEqual([
      PublicGatewayCollectionStatus.CONNECTED,
      PublicGatewayCollectionStatus.DISCONNECTED,
      PublicGatewayCollectionStatus.CONNECTED,
    ]);
  });

  test('Messages without types should be ignored', async () => {
    manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ foo: 'bar' });
      getSubprocessStream().write({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });

  test('Non-connection messages should be ignored', async () => {
    manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'invalid' });
      getSubprocessStream().write({ type: 'status', status: 'connected' });
    });

    await expect(
      pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray),
    ).resolves.toEqual([PublicGatewayCollectionStatus.CONNECTED]);
  });

  test('Breaking the iterable should not destroy the underlying stream', async () => {
    manager.start();
    setImmediate(() => {
      getSubprocessStream().write({ type: 'status', status: 'connected' });
    });

    await pipe(manager.streamStatus(), iterableTake(1), asyncIterableToArray);

    expect(getSubprocessStream().destroyed).toBeFalse();
    expect(getSubprocessStream().listenerCount('data')).toEqual(0);
  });

  test('Reconnection should be reported when subprocess is restarted', async () => {
    const subprocess1 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess1);
    const subprocess2 = new PassThrough({ objectMode: true });
    mockFork.mockReturnValueOnce(subprocess2);
    manager.start();

    setImmediate(async () => {
      subprocess1.write({ type: 'status', status: 'connected' });
      await manager.restart();
      subprocess2.write({ type: 'status', status: 'connected' });
    });
    await expect(
      pipe(manager.streamStatus(), iterableTake(3), asyncIterableToArray),
    ).resolves.toEqual([
      PublicGatewayCollectionStatus.CONNECTED,

      // Reconnect being reported:
      PublicGatewayCollectionStatus.DISCONNECTED,

      PublicGatewayCollectionStatus.CONNECTED,
    ]);
  });
});
