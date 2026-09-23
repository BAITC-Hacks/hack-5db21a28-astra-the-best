'use client';

import { useState } from 'react';
import type { AnalysisState, ScenarioResponse, SimulationResponse } from '@/contracts';
import { buildReportHtml, buildReportJson } from './report';
import styles from './ExportReport.module.css';

export function ExportReport({ scenario, simulation, analysis }: { scenario: ScenarioResponse; simulation: SimulationResponse; analysis: AnalysisState }) {
  const [notice, setNotice] = useState('');
  function download(format: 'html' | 'json') {
    try {
      const input = { scenario, simulation, analysis };
      const content = format === 'html' ? buildReportHtml(input) : buildReportJson(input);
      const url = URL.createObjectURL(new Blob([content], { type: format === 'html' ? 'text/html;charset=utf-8' : 'application/json;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `astana-report.${format}`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(format === 'html' ? 'Отчёт скачан. Откройте файл и выберите печать → «Сохранить как PDF».' : 'JSON с точными числами текущего сценария скачан.');
    } catch {
      setNotice('Не удалось экспортировать текущий результат. Повторите расчёт сценария.');
    }
  }
  return <section className={styles.export} aria-label="Экспорт отчёта"><div><h2>Сохранить результат</h2><p>Краткий отчёт для чтения и печати или точные данные для проверки.</p></div><div className={styles.actions}><button type="button" onClick={() => download('html')}>Скачать отчёт · HTML / PDF</button><button type="button" onClick={() => download('json')}>Скачать данные · JSON</button></div><p role="status" className={styles.notice}>{notice}</p></section>;
}
