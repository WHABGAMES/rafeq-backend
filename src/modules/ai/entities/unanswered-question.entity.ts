Skip to content
WHABGAMES
rafeq-backend
Repository navigation
Code
Issues
Pull requests
4
 (4)
Agents
Actions
Projects
Wiki
Security and quality
Insights
Settings
rafeq-backend/src/modules/ai/entities
/
unanswered-question.entity.ts
in
main

Edit

Preview
Indent mode

Spaces
Indent size

2
Line wrap mode

No wrap
Editing unanswered-question.entity.ts file contents
1
2
3
4
5
6
7
8
9
10
11
12
13
14
15
16
17
18
19
20
21
22
23
24
25
26
27
28
29
30
31
32
33
34
35
36
37
38
39
40
41
42
43
44
45
46
47
48
49
50
51
52
53
54
55
56
57
58
59
60
61
62
63
64
65
66
67
68
69
70
71
72
73
74
75
76
77
78
79
80
81
82
83
84
85
86
87
88
89
90
91
92
93
94
95
96
97
98
99
100
101
102
103
104
105
106
107
108
109
110
111
112
113
114
115
116
117
118
119
120
/**
 * ╔═══════════════════════════════════════════════════════════════════════════════╗
 * ║          RAFIQ PLATFORM - AI Learning Entity v2                                ║
 * ║                                                                                ║
 * ║  ✅ v2: رصد شامل — جميع رسائل العملاء + ردود البوت + تعديلات التاجر         ║
 * ║                                                                                ║
 * ║  يُجمّع الأسئلة المتشابهة تلقائياً بـ embedding similarity                    ║
 * ║  يعرضها للتاجر مع رد البوت → التاجر يعدّل → يضيف للمكتبة                    ║
 * ╚═══════════════════════════════════════════════════════════════════════════════╝
 */

import { Entity, Column, Index } from 'typeorm';
import { BaseEntity } from '../../../database/entities/base.entity';

export enum UnansweredStatus {
  PENDING = 'pending',     // ينتظر مراجعة من التاجر
  RESOLVED = 'resolved',   // التاجر أضاف الجواب للمكتبة
  DISMISSED = 'dismissed',  // التاجر تجاهله (مش مهم)
}

export enum CaptureSource {
  ALL = 'all',                   // رصد شامل (كل رسالة)
  LOW_CONFIDENCE = 'low_confidence', // ثقة منخفضة
  NO_MATCH = 'no_match',         // بدون إجابة
}

@Entity('ai_unanswered_questions')
@Index(['tenantId', 'status'])
@Index(['tenantId', 'hitCount'])
@Index(['tenantId', 'captureSource', 'status'])
export class UnansweredQuestion extends BaseEntity {
  @Column({ name: 'tenant_id', type: 'uuid' })
  @Index('idx_unanswered_tenant')
  tenantId: string;

  @Column({ name: 'store_id', type: 'uuid', nullable: true })
  storeId?: string;

  @Column({ name: 'conversation_id', type: 'uuid', nullable: true })
  conversationId?: string;

  /**
   * السؤال التمثيلي — أول سؤال في المجموعة
   */
  @Column({ name: 'representative_question', type: 'text' })
  representativeQuestion: string;

  /**
   * عيّنات من الصياغات المختلفة — آخر 5 صياغات
   */
  @Column({ name: 'sample_variations', type: 'jsonb', default: '[]' })
  sampleVariations: string[];

  /**
   * عدد مرات تكرار السؤال
   */
  @Column({ name: 'hit_count', type: 'int', default: 1 })
  hitCount: number;

  /**
   * آخر مرة سُئل
   */
  @Column({ name: 'last_asked_at', type: 'timestamptz', default: () => 'NOW()' })
  lastAskedAt: Date;

  /**
   * Intent المُكتشف
   */
  @Column({ name: 'detected_intent', type: 'varchar', length: 50, nullable: true })
  detectedIntent?: string;

  /**
   * الحالة
   */
  @Column({
    type: 'varchar',
    length: 20,
    default: UnansweredStatus.PENDING,
  })
  status: UnansweredStatus;

  /**
   * Embedding للتجميع الذكي
   */
  @Column({ type: 'jsonb', nullable: true })
  embedding?: number[];

  /**
   * ID المعلومة في المكتبة (إذا أُضيف)
   */
  @Column({ name: 'resolved_knowledge_id', type: 'uuid', nullable: true })
  resolvedKnowledgeId?: string;

  // ═══════════════════════════════════════════════════════════════
  // ✅ v2: New columns
  // ═══════════════════════════════════════════════════════════════

  /**
   * رد البوت على هذا السؤال — آخر رد أُرسل
   */
  @Column({ name: 'bot_response', type: 'text', nullable: true })
  botResponse?: string;

  /**
   * جواب التاجر المعدّل — الرد اللي يبي البوت يستخدمه
   */
  @Column({ name: 'merchant_answer', type: 'text', nullable: true })
  merchantAnswer?: string;

  /**
   * مصدر الرصد
   */
  @Column({
    name: 'capture_source',
    type: 'varchar',
    length: 20,
    default: CaptureSource.NO_MATCH,
  })
  captureSource: CaptureSource;
}
Use Control + Shift + m to toggle the tab key moving focus. Alternatively, use esc then tab to move to the next interactive element on the page.
 
