import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ZidWebhookProcessor } from '../zid-webhook.processor';
import { ZidWebhooksService } from '../../zid-webhooks.service';
import { Order, OrderStatus, PaymentStatus } from '@database/entities/order.entity';
import { Customer } from '@database/entities/customer.entity';
import { Store } from '@modules/stores/entities/store.entity';

describe('ZidWebhookProcessor persistence boundaries', () => {
  const makeProcessor = (existingOrder: Order | null = null) => {
    const orderRepository = {
      findOne: jest.fn().mockResolvedValue(existingOrder),
      create: jest.fn((value: Partial<Order>) => value as Order),
      save: jest.fn((value: Order) => Promise.resolve(value)),
    };

    const processor = new ZidWebhookProcessor(
      {} as ZidWebhooksService,
      { emit: jest.fn() } as unknown as EventEmitter2,
      orderRepository as unknown as Repository<Order>,
      {} as Repository<Customer>,
      {} as Repository<Store>,
    );

    return { processor, orderRepository };
  };

  it('stores a new Zid order in zidOrderId and zidData', async () => {
    const { processor, orderRepository } = makeProcessor();

    await processor['syncOrderToDatabase'](
      { id: 321, status: 'new', total: 50, items: [] },
      { tenantId: 'tenant-1', storeId: 'store-1' },
    );

    expect(orderRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      zidOrderId: '321',
      metadata: expect.objectContaining({
        source: 'zid',
        zidData: expect.objectContaining({ id: 321 }),
      }),
    }));
    expect(orderRepository.create.mock.calls[0][0]).not.toHaveProperty('sallaOrderId');
  });

  it('finds a legacy Zid order and migrates its external identifier on update', async () => {
    const legacyOrder = Object.assign(new Order(), {
      id: 'order-1',
      storeId: 'store-1',
      sallaOrderId: '321',
      status: OrderStatus.CREATED,
      paymentStatus: PaymentStatus.PENDING,
      items: [],
      totalAmount: 0,
      metadata: { source: 'zid' },
    });
    const { processor, orderRepository } = makeProcessor(legacyOrder);

    await processor['syncOrderToDatabase'](
      { id: 321, status: 'processing', total: 75, items: [] },
      { tenantId: 'tenant-1', storeId: 'store-1' },
    );

    expect(orderRepository.findOne).toHaveBeenCalledWith({
      where: [
        { zidOrderId: '321', storeId: 'store-1' },
        { sallaOrderId: '321', storeId: 'store-1' },
      ],
    });
    expect(legacyOrder.zidOrderId).toBe('321');
    expect(orderRepository.save).toHaveBeenCalledWith(legacyOrder);
  });
});
