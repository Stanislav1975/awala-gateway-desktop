import pipe from 'it-pipe';
import { PassThrough } from 'stream';
import { sink } from 'stream-to-it';
import { Container } from 'typedi';
import { Server } from 'ws';

import { UnregisteredGatewayError } from '../../errors';
import { CourierSyncManager } from '../../sync/courierSync/CourierSyncManager';
import { DisconnectedFromCourierError } from '../../sync/courierSync/errors';
import { LOGGER } from '../../tokens';
import { makeWebSocketServer } from '../websocket';
import { CONTROL_API_PREFIX } from './index';

export const PATH = `${CONTROL_API_PREFIX}/courier-sync`;

export default function makeCourierSyncServer(authToken: string): Server {
  const logger = Container.get(LOGGER);

  return makeWebSocketServer(
    async (connectionStream, socket) => {
      const courierSync = Container.get(CourierSyncManager);

      // Wrap the WS writable stream to prevent it from closing with a 1006:
      // https://github.com/websockets/ws/issues/1811
      const sinkWrapper = new PassThrough({
        final(): void {
          socket.close(1000);
        },
        objectMode: true,
      });
      sinkWrapper.pipe(connectionStream);

      try {
        await pipe(courierSync.sync(), sink(sinkWrapper));
      } catch (err) {
        let closeCode: number;
        let closeReason: string;
        if (err instanceof UnregisteredGatewayError) {
          logger.warn('Aborting courier sync because gateway is unregistered');
          closeCode = 4000;
          closeReason = 'Gateway is not yet registered';
        } else if (err instanceof DisconnectedFromCourierError) {
          logger.warn('Aborting courier sync because device is not connected to a courier');
          closeCode = 4001;
          closeReason = 'Device is not connected to a courier';
        } else {
          logger.error({ err }, 'Unexpected error when syncing with courier');
          closeCode = 1011;
          closeReason = 'Internal server error';
        }
        socket.close(closeCode, closeReason);
        return;
      }
    },
    { authToken },
  );
}
