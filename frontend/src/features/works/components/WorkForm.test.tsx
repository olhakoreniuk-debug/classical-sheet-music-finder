import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createMockCatalogApi } from '../../../mock/mockCatalogApi';
import { makeWork } from '../../../test/fixtures';
import { renderWithApi } from '../../../test/renderWithApi';
import { WorkForm } from './WorkForm';

describe('WorkForm', () => {
  it('shows API validation errors beside the fields and in a focused summary', async () => {
    const user = userEvent.setup();
    renderWithApi(<WorkForm onCreated={vi.fn()} />, createMockCatalogApi({ delayMs: 0, works: [] }));

    await user.type(screen.getByLabelText(/^Title/), '   ');
    await user.type(screen.getByLabelText(/^Page URL/), 'not a url');
    await user.click(screen.getByRole('button', { name: 'Add work' }));

    const summary = await screen.findByRole('alert');
    expect(summary.textContent).toContain('Please correct these 2 fields');
    expect(document.activeElement).toBe(summary);

    const title = screen.getByLabelText(/^Title/);
    expect(title.getAttribute('aria-invalid')).toBe('true');
    const errorId = title.getAttribute('aria-describedby')?.split(' ').find((id) => id.endsWith('-error'));
    expect(errorId && document.getElementById(errorId)?.textContent).toContain('non-space character');
    expect(screen.getByLabelText(/^Page URL/).getAttribute('aria-invalid')).toBe('true');
  });

  it('shows a duplicate page URL (409) at the Page URL field', async () => {
    const user = userEvent.setup();
    const existing = makeWork(1, { pageUrl: 'https://a.example/works/1' });
    renderWithApi(<WorkForm onCreated={vi.fn()} />, createMockCatalogApi({ delayMs: 0, works: [existing] }));

    await user.type(screen.getByLabelText(/^Title/), 'Copy');
    await user.type(screen.getByLabelText(/^Page URL/), 'https://a.example/works/1');
    await user.click(screen.getByRole('button', { name: 'Add work' }));

    expect((await screen.findByRole('alert')).textContent).toContain('already has this pageUrl');
    expect(screen.getByLabelText(/^Page URL/).getAttribute('aria-invalid')).toBe('true');
  });

  it('calls onCreated with the new work after a successful submission', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    renderWithApi(<WorkForm onCreated={onCreated} />, createMockCatalogApi({ delayMs: 0, works: [] }));

    await user.type(screen.getByLabelText(/^Title/), 'Erlkönig');
    await user.type(screen.getByLabelText(/^Composer/), 'Schubert, Franz');
    await user.click(screen.getByRole('button', { name: 'Add work' }));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledTimes(1));
    expect(onCreated.mock.calls[0]?.[0]).toMatchObject({ title: 'Erlkönig', source: { code: 'manual' } });
  });

  it('explains when writes are disabled on the server (403)', async () => {
    const user = userEvent.setup();
    renderWithApi(<WorkForm onCreated={vi.fn()} />, createMockCatalogApi({ delayMs: 0, works: [], writesEnabled: false }));
    await user.type(screen.getByLabelText(/^Title/), 'Anything');
    await user.click(screen.getByRole('button', { name: 'Add work' }));
    expect((await screen.findByRole('alert')).textContent).toContain('disabled on this server');
    // Read-only state: explained, and Save is no longer offered.
    expect(screen.getByText('Read-only server.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Add work' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
