import { Repository } from 'typeorm';
import { CsatService } from './csat.service';
import { CsatSurvey, CsatSurveyStatus, CsatSurveyType } from './entities/csat-survey.entity';

describe('CsatService export', () => {
  it('creates a downloadable UTF-8 CSV and neutralizes spreadsheet formulas', async () => {
    const find = jest.fn().mockResolvedValue([{
      id: 'survey-1',
      type: CsatSurveyType.CSAT,
      status: CsatSurveyStatus.COMPLETED,
      rating: 5,
      feedback: '=HYPERLINK("https://invalid.example")',
      customerId: 'customer-1',
      agentId: null,
      conversationId: 'conversation-1',
      storeId: 'store-1',
      respondedAt: new Date('2026-10-02T10:00:00.000Z'),
    }]);
    const repository = { find } as unknown as Repository<CsatSurvey>;
    const service = new CsatService(repository);

    const result = await service.exportSurveys('tenant-1', { format: 'csv' });

    expect(result.contentType).toBe('text/csv; charset=utf-8');
    expect(result.filename).toMatch(/^rafeq-csat-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(result.content.startsWith('\uFEFFid,type,rating')).toBe(true);
    expect(result.content).toContain(`"'=HYPERLINK(""https://invalid.example"")"`);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: 'tenant-1' }),
    }));
  });
});
