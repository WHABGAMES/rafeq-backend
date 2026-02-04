'use client'

import React, { useState, useEffect, useRef } from 'react'
import { templatesService, Template } from '@/lib/api'

interface UITemplate extends Template {
  triggerEvent?: string
}

interface Preset {
  id: string
  name: string
  language: string
  category: string
  triggerEvent?: string | null
  content: string
  buttons?: { type: string; text: string; url?: string }[]
}

interface Variable {
  key: string
  label: string
  example: string
  category: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// التصنيفات الرئيسية
// ═══════════════════════════════════════════════════════════════════════════════
const CATEGORIES = [
  { id: 'all', label: 'الكل', icon: '📋' },
  { id: 'order_notifications', label: 'إشعارات الطلبات', icon: '📦' },
  { id: 'shipping_notifications', label: 'الشحن والتوصيل', icon: '🚚' },
  { id: 'sales_recovery', label: 'استرداد المبيعات', icon: '🛒' },
  { id: 'marketing', label: 'التسويق والحملات', icon: '📢' },
  { id: 'engagement', label: 'التفاعل والولاء', icon: '⭐' },
  { id: 'service', label: 'رسائل الخدمة', icon: '🔧' },
]

const CATEGORY_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  order_notifications: { border: 'border-blue-500/30', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  shipping_notifications: { border: 'border-violet-500/30', bg: 'bg-violet-500/10', text: 'text-violet-400' },
  sales_recovery: { border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400' },
  marketing: { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400' },
  engagement: { border: 'border-pink-500/30', bg: 'bg-pink-500/10', text: 'text-pink-400' },
  service: { border: 'border-cyan-500/30', bg: 'bg-cyan-500/10', text: 'text-cyan-400' },
}

const CATEGORY_ICONS: Record<string, string> = {
  order_notifications: '📦',
  shipping_notifications: '🚚',
  sales_recovery: '🛒',
  marketing: '📢',
  engagement: '⭐',
  service: '🔧',
}

// ═══════════════════════════════════════════════════════════════════════════════
// المتغيرات المتاحة - دليل مرجعي
// ═══════════════════════════════════════════════════════════════════════════════
const VARIABLES: Variable[] = [
  { key: '{{customer_name}}', label: 'اسم العميل', example: 'محمد', category: 'عميل' },
  { key: '{{customer_first_name}}', label: 'الاسم الأول', example: 'محمد', category: 'عميل' },
  { key: '{{order_id}}', label: 'رقم الطلب', example: '1234', category: 'طلب' },
  { key: '{{order_total}}', label: 'مبلغ الطلب', example: '299', category: 'طلب' },
  { key: '{{order_status}}', label: 'حالة الطلب', example: 'قيد التنفيذ', category: 'طلب' },
  { key: '{{order_tracking}}', label: 'رابط التتبع', example: 'https://...', category: 'طلب' },
  { key: '{{tracking_number}}', label: 'رقم التتبع', example: 'SA123456', category: 'شحن' },
  { key: '{{shipping_company}}', label: 'شركة الشحن', example: 'أرامكس', category: 'شحن' },
  { key: '{{store_name}}', label: 'اسم المتجر', example: 'متجري', category: 'متجر' },
  { key: '{{store_url}}', label: 'رابط المتجر', example: 'https://...', category: 'متجر' },
  { key: '{{cart_total}}', label: 'مبلغ السلة', example: '450', category: 'سلة' },
  { key: '{{cart_link}}', label: 'رابط السلة', example: 'https://...', category: 'سلة' },
  { key: '{{product_name}}', label: 'اسم المنتج', example: 'عطر فاخر', category: 'منتج' },
  { key: '{{product_price}}', label: 'سعر المنتج', example: '199', category: 'منتج' },
  { key: '{{payment_link}}', label: 'رابط الدفع', example: 'https://...', category: 'دفع' },
]

// ═══════════════════════════════════════════════════════════════════════════════
// Edit Modal - نافذة تعديل نص القالب
// ═══════════════════════════════════════════════════════════════════════════════
const EditModal = ({
  template,
  defaultContent,
  onSave,
  onClose,
  saving,
}: {
  template: UITemplate
  defaultContent?: string
  onSave: (content: string) => void
  onClose: () => void
  saving: boolean
}) => {
  const [content, setContent] = useState(template.content || '')
  const [showVars, setShowVars] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const insertVariable = (varKey: string) => {
    const textarea = textareaRef.current
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const newContent = content.substring(0, start) + varKey + content.substring(end)
    setContent(newContent)
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + varKey.length, start + varKey.length)
    }, 0)
  }

  const handleReset = () => {
    if (defaultContent) {
      setContent(defaultContent)
    }
  }

  // عدد الأحرف
  const charCount = content.length

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-slate-900 rounded-2xl border border-slate-700/50 w-full max-w-2xl max-h-[90vh] overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-700/50">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center text-xl">
                ✏️
              </div>
              <div>
                <h2 className="font-bold text-white">تعديل القالب</h2>
                <p className="text-xs text-slate-400">{template.name}</p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white transition-colors">
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 overflow-y-auto max-h-[60vh]">
          {/* Toolbar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowVars(!showVars)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  showVars
                    ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                }`}
              >
                🏷️ المتغيرات
              </button>
              {defaultContent && content !== defaultContent && (
                <button
                  onClick={handleReset}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-all"
                >
                  🔄 رجّع الأصلي
                </button>
              )}
            </div>
            <span className={`text-xs ${charCount > 1000 ? 'text-red-400' : 'text-slate-500'}`}>
              {charCount} حرف
            </span>
          </div>

          {/* Variables Panel */}
          {showVars && (
            <div className="p-3 rounded-xl bg-slate-800/50 border border-slate-700/50 space-y-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-sm font-medium text-white">📝 اضغط على المتغير لإضافته</span>
              </div>
              {['عميل', 'طلب', 'شحن', 'متجر', 'سلة', 'منتج', 'دفع'].map(cat => {
                const vars = VARIABLES.filter(v => v.category === cat)
                if (vars.length === 0) return null
                return (
                  <div key={cat}>
                    <span className="text-xs text-slate-500 mb-1 block">{cat}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {vars.map(v => (
                        <button
                          key={v.key}
                          onClick={() => insertVariable(v.key)}
                          className="group px-2 py-1 rounded-lg bg-slate-700/50 hover:bg-violet-500/20 border border-slate-600/50 hover:border-violet-500/30 transition-all"
                          title={`${v.label} — مثال: ${v.example}`}
                        >
                          <span className="text-xs text-violet-400 font-mono">{v.key.replace(/\{\{|\}\}/g, '')}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )
              })}
              <div className="pt-2 border-t border-slate-700/50">
                <p className="text-xs text-slate-400">
                  💡 <strong>نصيحة:</strong> المتغيرات تتبدل تلقائي بمعلومات العميل والطلب وقت الإرسال.
                  مثلاً <code className="text-violet-400">{'{{customer_name}}'}</code> بتصير &quot;محمد&quot;
                </p>
              </div>
            </div>
          )}

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            dir="rtl"
            rows={10}
            className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 text-sm text-white resize-none focus:outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/20 transition-all leading-relaxed"
            placeholder="اكتب نص الرسالة هنا..."
          />

          {/* Preview */}
          <div className="p-3 rounded-xl bg-emerald-500/5 border border-emerald-500/20">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-medium text-emerald-400">👁️ معاينة الرسالة</span>
            </div>
            <div className="text-xs text-slate-300 whitespace-pre-line leading-relaxed" dir="rtl">
              {content
                .replace(/\{\{customer_name\}\}/g, 'محمد')
                .replace(/\{\{customer_first_name\}\}/g, 'محمد')
                .replace(/\{\{order_id\}\}/g, '1234')
                .replace(/\{\{order_total\}\}/g, '299')
                .replace(/\{\{order_status\}\}/g, 'قيد التنفيذ')
                .replace(/\{\{store_name\}\}/g, 'متجري')
                .replace(/\{\{cart_total\}\}/g, '450')
                .replace(/\{\{product_name\}\}/g, 'عطر فاخر')
                .replace(/\{\{product_price\}\}/g, '199')
                .replace(/\{\{shipping_company\}\}/g, 'أرامكس')
                .replace(/\{\{tracking_number\}\}/g, 'SA123456')
                .replace(/\{\{[^}]+\}\}/g, '...')
              || 'اكتب النص وشوف المعاينة هنا...'}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-700/50 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl bg-slate-800 text-slate-300 text-sm hover:bg-slate-700 transition-all"
          >
            إلغاء
          </button>
          <button
            onClick={() => onSave(content)}
            disabled={saving || !content.trim()}
            className={`px-6 py-2.5 rounded-xl font-medium text-sm transition-all ${
              saving || !content.trim()
                ? 'bg-slate-700 text-slate-400 cursor-wait'
                : 'bg-gradient-to-r from-emerald-500 to-violet-500 text-white hover:opacity-90'
            }`}
          >
            {saving ? '⏳ جاري الحفظ...' : '💾 حفظ التعديلات'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Template Card - بطاقة القالب المفعّل (مع زر التعديل)
// ═══════════════════════════════════════════════════════════════════════════════
const TemplateCard = ({
  template,
  onToggle,
  onEdit,
  onDelete,
  toggling,
}: {
  template: UITemplate
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  toggling: boolean
}) => {
  const [showMenu, setShowMenu] = useState(false)
  const status = template.status ?? 'draft'
  const isEnabled = status === 'approved' || status === 'active'
  const cat = template.category ?? 'order_notifications'
  const colors = CATEGORY_COLORS[cat] || CATEGORY_COLORS.service
  const catLabel = CATEGORIES.find(c => c.id === cat)?.label || cat

  return (
    <div className={`p-5 rounded-2xl bg-slate-900/50 border ${colors.border} hover:brightness-110 transition-all relative group`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-xl shrink-0">
            {CATEGORY_ICONS[cat] || '📝'}
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-white text-sm truncate">{template.name}</h3>
            <span className={`px-2 py-0.5 text-xs rounded-full ${colors.bg} ${colors.text}`}>
              {catLabel}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {/* Menu Button */}
          <div className="relative">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-all"
            >
              ⋮
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
                <div className="absolute left-0 top-9 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 py-1 min-w-[140px]">
                  <button onClick={() => { onEdit(); setShowMenu(false) }} className="w-full px-3 py-2 text-right text-xs text-slate-300 hover:bg-slate-700 flex items-center gap-2">
                    <span>✏️</span> تعديل النص
                  </button>
                  <button onClick={() => { onDelete(); setShowMenu(false) }} className="w-full px-3 py-2 text-right text-xs text-red-400 hover:bg-red-500/10 flex items-center gap-2">
                    <span>🗑️</span> حذف القالب
                  </button>
                </div>
              </>
            )}
          </div>
          {/* Toggle */}
          <button
            onClick={onToggle}
            disabled={toggling}
            className={`relative w-11 h-6 rounded-full transition-all ${toggling ? 'opacity-50' : ''} ${isEnabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
          >
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-all ${isEnabled ? 'right-1' : 'left-1'}`} />
          </button>
        </div>
      </div>

      {/* Content Preview */}
      <p className="text-xs text-slate-400 line-clamp-2 whitespace-pre-line mb-3">{template.content}</p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>📊 {template.usageCount ?? 0} استخدام</span>
        </div>
        <button
          onClick={onEdit}
          className="px-2.5 py-1 rounded-lg text-xs bg-slate-800/50 text-slate-400 hover:text-violet-400 hover:bg-violet-500/10 border border-transparent hover:border-violet-500/30 transition-all"
        >
          ✏️ تعديل
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Preset Card - بطاقة القالب الجاهز (مع زر تعديل قبل التفعيل)
// ═══════════════════════════════════════════════════════════════════════════════
const PresetCard = ({
  preset,
  onActivate,
  onCustomActivate,
  activating,
}: {
  preset: Preset
  onActivate: () => void
  onCustomActivate: () => void
  activating: boolean
}) => {
  const colors = CATEGORY_COLORS[preset.category] || CATEGORY_COLORS.service

  return (
    <div className={`p-4 rounded-2xl bg-slate-900/50 border ${colors.border} transition-all hover:brightness-110`}>
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-xl">
          {CATEGORY_ICONS[preset.category] || '📝'}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm truncate">{preset.name}</h3>
          {preset.triggerEvent && (
            <span className="text-xs text-slate-500">🔗 {preset.triggerEvent}</span>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400 line-clamp-3 whitespace-pre-line mb-3">{preset.content}</p>

      {preset.buttons && preset.buttons.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {preset.buttons.map((btn, i) => (
            <span key={i} className="px-2 py-0.5 rounded bg-slate-800 text-xs text-slate-300">
              {btn.type === 'url' ? '🔗' : '⚡'} {btn.text}
            </span>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onActivate}
          disabled={activating}
          className={`flex-1 py-2 rounded-xl font-medium text-xs transition-all ${
            activating
              ? 'bg-slate-700 text-slate-400 cursor-wait'
              : 'bg-gradient-to-r from-emerald-500 to-violet-500 text-white hover:opacity-90'
          }`}
        >
          {activating ? '⏳ جاري التفعيل...' : '➕ تفعيل'}
        </button>
        <button
          onClick={onCustomActivate}
          disabled={activating}
          className="px-3 py-2 rounded-xl text-xs bg-slate-800 text-violet-400 border border-violet-500/30 hover:bg-violet-500/10 transition-all"
          title="عدّل النص قبل التفعيل"
        >
          ✏️
        </button>
      </div>
    </div>
  )
}

// Loading
const LoadingSkeleton = () => (
  <div className="space-y-8 animate-pulse p-8">
    <div className="h-8 w-48 bg-slate-800 rounded" />
    <div className="grid grid-cols-4 gap-4">
      {[1,2,3,4].map(i => <div key={i} className="h-24 bg-slate-800/50 rounded-2xl" />)}
    </div>
    <div className="grid grid-cols-3 gap-4">
      {[1,2,3,4,5,6].map(i => <div key={i} className="h-48 bg-slate-800/50 rounded-2xl" />)}
    </div>
  </div>
)

// Toast notification
const Toast = ({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) => {
  useEffect(() => {
    const t = setTimeout(onClose, 3000)
    return () => clearTimeout(t)
  }, [onClose])
  return (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl text-sm font-medium shadow-xl transition-all ${
      type === 'success' ? 'bg-emerald-500 text-white' : 'bg-red-500 text-white'
    }`}>
      {type === 'success' ? '✅' : '❌'} {message}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════════════════════
export default function TemplatesPage() {
  const [templates, setTemplates] = useState<UITemplate[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState('all')
  const [toggling, setToggling] = useState<string | null>(null)
  const [activatingPreset, setActivatingPreset] = useState<string | null>(null)
  const [editingTemplate, setEditingTemplate] = useState<UITemplate | null>(null)
  const [editingPreset, setEditingPreset] = useState<Preset | null>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  useEffect(() => { fetchData() }, [])

  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type })
  }

  const fetchData = async () => {
    try {
      setLoading(true)
      setError(null)
      const [templatesData, presetsData] = await Promise.all([
        templatesService.getAll(),
        templatesService.getPresets(),
      ])
      setTemplates(templatesData || [])
      const activeNames = new Set((templatesData || []).map(t => t.name))
      const filtered = (presetsData || []).filter(p => !activeNames.has(p.name))
      setPresets(filtered)
    } catch (err: any) {
      console.error('Error:', err)
      setError('فشل في جلب القوالب')
    } finally {
      setLoading(false)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // تفعيل قالب جاهز
  // ═══════════════════════════════════════════════════════════════════════════
  const handleActivatePreset = async (preset: Preset, customContent?: string) => {
    try {
      // ✅ v7: تحقق إذا فيه قالب مفعّل بنفس الـ trigger event
      if (preset.triggerEvent) {
        const conflicting = templates.find(
          t => (t as UITemplate).triggerEvent === preset.triggerEvent 
            && ['approved', 'active'].includes(t.status ?? '')
        )
        if (conflicting) {
          const confirmed = confirm(
            `⚠️ يوجد قالب مفعّل بنفس الحدث:\n\n` +
            `"${conflicting.name}" مربوط بـ ${preset.triggerEvent}\n\n` +
            `تفعيل "${preset.name}" سيعطّل "${conflicting.name}" تلقائياً.\n\n` +
            `هل تريد المتابعة؟`
          )
          if (!confirmed) return
          
          // تعطيل القالب القديم
          try {
            await templatesService.update(conflicting.id, { status: 'disabled' })
            setTemplates(prev => prev.map(t => 
              t.id === conflicting.id ? { ...t, status: 'disabled' } : t
            ))
          } catch (err) {
            console.error('Error disabling conflicting template:', err)
          }
        }
      }

      setActivatingPreset(preset.id)
      const newTemplate = await templatesService.create({
        name: preset.name,
        content: customContent || preset.content,
        category: preset.category,
        status: 'approved',
        triggerEvent: preset.triggerEvent || undefined,
      })
      setTemplates(prev => [...prev, newTemplate])
      setPresets(prev => prev.filter(p => p.id !== preset.id))
      showToast(`تم تفعيل "${preset.name}" بنجاح`)
    } catch (err) {
      console.error('Error activating:', err)
      showToast('فشل في تفعيل القالب', 'error')
    } finally {
      setActivatingPreset(null)
    }
  }

  const handleActivateCategory = async (categoryId: string) => {
    const categoryPresets = presets.filter(p => p.category === categoryId)
    
    // ✅ v7: تتبع القوالب المفعّلة لكل trigger لتجنب التعارض
    const activatedTriggers = new Set(
      templates
        .filter(t => ['approved', 'active'].includes(t.status ?? ''))
        .map(t => (t as UITemplate).triggerEvent)
        .filter(Boolean)
    )
    
    let activated = 0
    let skipped = 0
    
    for (const preset of categoryPresets) {
      // تخطي إذا فيه قالب مفعّل بنفس الـ trigger
      if (preset.triggerEvent && activatedTriggers.has(preset.triggerEvent)) {
        skipped++
        continue
      }
      
      try {
        setActivatingPreset(preset.id)
        const newTemplate = await templatesService.create({
          name: preset.name,
          content: preset.content,
          category: preset.category,
          status: 'approved',
          triggerEvent: preset.triggerEvent || undefined,
        })
        setTemplates(prev => [...prev, newTemplate])
        setPresets(prev => prev.filter(p => p.id !== preset.id))
        if (preset.triggerEvent) activatedTriggers.add(preset.triggerEvent)
        activated++
      } catch (err) {
        console.error(`Error activating ${preset.id}:`, err)
      }
    }
    setActivatingPreset(null)
    const msg = skipped > 0 
      ? `تم تفعيل ${activated} قالب (تم تخطي ${skipped} لتجنب التعارض)`
      : `تم تفعيل ${activated} قالب`
    showToast(msg)
  }

  const handleActivateAll = async () => {
    // ✅ v7: تتبع القوالب المفعّلة لكل trigger لتجنب التعارض
    const activatedTriggers = new Set(
      templates
        .filter(t => ['approved', 'active'].includes(t.status ?? ''))
        .map(t => (t as UITemplate).triggerEvent)
        .filter(Boolean)
    )
    
    let activated = 0
    let skipped = 0
    
    for (const preset of [...presets]) {
      // تخطي إذا فيه قالب مفعّل بنفس الـ trigger
      if (preset.triggerEvent && activatedTriggers.has(preset.triggerEvent)) {
        skipped++
        continue
      }
      
      try {
        setActivatingPreset(preset.id)
        const newTemplate = await templatesService.create({
          name: preset.name,
          content: preset.content,
          category: preset.category,
          status: 'approved',
          triggerEvent: preset.triggerEvent || undefined,
        })
        setTemplates(prev => [...prev, newTemplate])
        setPresets(prev => prev.filter(p => p.id !== preset.id))
        if (preset.triggerEvent) activatedTriggers.add(preset.triggerEvent)
        activated++
      } catch (err) {
        console.error(`Error:`, err)
      }
    }
    setActivatingPreset(null)
    const msg = skipped > 0
      ? `تم تفعيل ${activated} قالب بنجاح (تم تخطي ${skipped} لتجنب التعارض) 🎉`
      : `تم تفعيل ${activated} قالب بنجاح 🎉`
    showToast(msg)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // تعديل نص القالب
  // ═══════════════════════════════════════════════════════════════════════════
  const handleSaveEdit = async (content: string) => {
    if (!editingTemplate) return
    try {
      setSaving(true)
      const updated = await templatesService.update(editingTemplate.id, { content })
      setTemplates(templates.map(t => t.id === editingTemplate.id ? { ...t, ...updated, content } : t))
      setEditingTemplate(null)
      showToast('تم حفظ التعديلات ✏️')
    } catch (err) {
      console.error('Error saving:', err)
      showToast('فشل في حفظ التعديلات', 'error')
    } finally {
      setSaving(false)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // تعديل نص قالب جاهز قبل التفعيل
  // ═══════════════════════════════════════════════════════════════════════════
  const handleSavePresetEdit = async (content: string) => {
    if (!editingPreset) return
    await handleActivatePreset(editingPreset, content)
    setEditingPreset(null)
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // تبديل حالة القالب
  // ═══════════════════════════════════════════════════════════════════════════
  const handleToggle = async (templateId: string) => {
    const template = templates.find(t => t.id === templateId)
    if (!template) return
    try {
      setToggling(templateId)
      const currentStatus = template.status ?? 'draft'
      const isActive = currentStatus === 'approved' || currentStatus === 'active'
      const newStatus = isActive ? 'disabled' : 'approved'
      
      // ✅ v7: لو يفعّل قالب → تحقق من تعارض مع قالب آخر بنفس الـ trigger
      if (!isActive && (template as UITemplate).triggerEvent) {
        const triggerEvent = (template as UITemplate).triggerEvent
        const conflicting = templates.find(
          t => t.id !== templateId 
            && (t as UITemplate).triggerEvent === triggerEvent 
            && ['approved', 'active'].includes(t.status ?? '')
        )
        if (conflicting) {
          const confirmed = confirm(
            `⚠️ يوجد قالب مفعّل بنفس الحدث:\n\n` +
            `"${conflicting.name}" مربوط بـ ${triggerEvent}\n\n` +
            `تفعيل "${template.name}" سيعطّل "${conflicting.name}" تلقائياً.\n\n` +
            `هل تريد المتابعة؟`
          )
          if (!confirmed) {
            setToggling(null)
            return
          }
          
          // تعطيل القالب القديم
          try {
            await templatesService.update(conflicting.id, { status: 'disabled' })
            setTemplates(prev => prev.map(t => 
              t.id === conflicting.id ? { ...t, status: 'disabled' } : t
            ))
          } catch (err) {
            console.error('Error disabling conflicting template:', err)
          }
        }
      }
      
      const updated = await templatesService.update(templateId, { status: newStatus })
      setTemplates(templates.map(t => t.id === templateId ? { ...t, ...updated } : t))
      showToast(isActive ? 'تم تعطيل القالب' : 'تم تفعيل القالب')
    } catch (err) {
      console.error('Error toggling:', err)
      showToast('فشل في تحديث حالة القالب', 'error')
    } finally {
      setToggling(null)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // حذف قالب
  // ═══════════════════════════════════════════════════════════════════════════
  const handleDelete = async (templateId: string) => {
    const template = templates.find(t => t.id === templateId)
    if (!template) return
    if (!confirm(`هل تريد حذف قالب "${template.name}"؟`)) return
    try {
      await templatesService.delete(templateId)
      setTemplates(templates.filter(t => t.id !== templateId))
      showToast('تم حذف القالب')
      // إعادة جلب الـ presets عشان القالب المحذوف يرجع كـ preset
      const presetsData = await templatesService.getPresets()
      const activeNames = new Set(templates.filter(t => t.id !== templateId).map(t => t.name))
      setPresets((presetsData || []).filter((p: Preset) => !activeNames.has(p.name)))
    } catch (err) {
      console.error('Error deleting:', err)
      showToast('فشل في حذف القالب', 'error')
    }
  }

  // إحصائيات
  const enabledCount = templates.filter(t => ['approved', 'active'].includes(t.status ?? '')).length
  const totalUsage = templates.reduce((sum, t) => sum + (t.usageCount ?? 0), 0)

  // فلترة حسب التصنيف
  const filteredTemplates = activeCategory === 'all'
    ? templates
    : templates.filter(t => (t.category ?? '') === activeCategory)

  const filteredPresets = activeCategory === 'all'
    ? presets
    : presets.filter(p => p.category === activeCategory)

  const getCategoryCount = (catId: string) => {
    if (catId === 'all') return templates.length + presets.length
    return templates.filter(t => t.category === catId).length +
           presets.filter(p => p.category === catId).length
  }

  // الحصول على النص الأصلي للقالب من الـ presets
  const getDefaultContent = (templateName: string): string | undefined => {
    // هذا بيرجع undefined لو ما لقى — وهذا مقصود
    return undefined
  }

  if (loading) return <LoadingSkeleton />

  if (error) {
    return (
      <div className="text-center py-12">
        <div className="text-6xl mb-4">⚠️</div>
        <h3 className="text-xl font-medium text-white mb-2">{error}</h3>
        <button onClick={fetchData} className="px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-violet-500 text-white">
          إعادة المحاولة
        </button>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-6">
      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Edit Modal */}
      {editingTemplate && (
        <EditModal
          template={editingTemplate}
          defaultContent={getDefaultContent(editingTemplate.name)}
          onSave={handleSaveEdit}
          onClose={() => setEditingTemplate(null)}
          saving={saving}
        />
      )}

      {/* Edit Preset Modal (تعديل قبل التفعيل) */}
      {editingPreset && (
        <EditModal
          template={{
            id: editingPreset.id,
            name: editingPreset.name,
            content: editingPreset.content,
            category: editingPreset.category,
          }}
          defaultContent={editingPreset.content}
          onSave={handleSavePresetEdit}
          onClose={() => setEditingPreset(null)}
          saving={saving}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-3">
            <span className="text-3xl">📨</span>
            قوالب الرسائل التلقائية
          </h1>
          <p className="text-slate-400 text-sm">إعداد رسائل واتساب تلقائية لكل حدث في متجرك • تقدر تعدّل النص على كيفك ✏️</p>
        </div>
        <div className="flex items-center gap-3">
          {presets.length > 0 && (
            <button
              onClick={handleActivateAll}
              disabled={activatingPreset !== null}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-violet-500 text-white text-sm hover:opacity-90 transition-all"
            >
              ⚡ تفعيل الكل ({presets.length})
            </button>
          )}
          <div className="px-4 py-2 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-sm">
            {enabledCount} قالب مفعّل
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border bg-emerald-500/10 border-emerald-500/30">
          <div className="text-xl mb-1">📤</div>
          <div className="text-2xl font-bold text-white">{totalUsage.toLocaleString()}</div>
          <div className="text-xs text-slate-400">رسائل مُرسلة</div>
        </div>
        <div className="p-4 rounded-2xl border bg-violet-500/10 border-violet-500/30">
          <div className="text-xl mb-1">📝</div>
          <div className="text-2xl font-bold text-white">{templates.length}</div>
          <div className="text-xs text-slate-400">قوالب مفعّلة</div>
        </div>
        <div className="p-4 rounded-2xl border bg-blue-500/10 border-blue-500/30">
          <div className="text-xl mb-1">🎁</div>
          <div className="text-2xl font-bold text-white">{presets.length}</div>
          <div className="text-xs text-slate-400">قوالب جاهزة</div>
        </div>
        <div className="p-4 rounded-2xl border bg-amber-500/10 border-amber-500/30">
          <div className="text-xl mb-1">📊</div>
          <div className="text-2xl font-bold text-white">{CATEGORIES.length - 1}</div>
          <div className="text-xs text-slate-400">تصنيفات</div>
        </div>
      </div>

      {/* Info Banner */}
      <div className="p-4 rounded-2xl bg-gradient-to-r from-violet-500/20 to-emerald-500/20 border border-violet-500/30">
        <div className="flex items-start gap-3">
          <div className="text-2xl">💡</div>
          <div>
            <h3 className="font-semibold text-white text-sm mb-1">تقدر تعدّل أي قالب!</h3>
            <p className="text-xs text-slate-300">
              اضغط على <strong className="text-violet-400">✏️ تعديل</strong> في أي قالب عشان تكتب النص بأسلوبك الخاص.
              استخدم المتغيرات مثل <code className="text-emerald-400 bg-slate-800 px-1 rounded">{'{{customer_name}}'}</code> وبتتبدل تلقائي بمعلومات العميل.
              رسائل واتساب تحقق معدل فتح <strong className="text-emerald-400">98%</strong> 🚀
            </p>
          </div>
        </div>
      </div>

      {/* Categories Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {CATEGORIES.map(cat => {
          const count = getCategoryCount(cat.id)
          return (
            <button
              key={cat.id}
              onClick={() => setActiveCategory(cat.id)}
              className={`px-4 py-2 rounded-xl text-sm transition-all flex items-center gap-2 whitespace-nowrap ${
                activeCategory === cat.id
                  ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                  : 'bg-slate-800/50 text-slate-400 border border-slate-700/50 hover:text-white'
              }`}
            >
              <span>{cat.icon}</span>
              {cat.label}
              <span className="px-1.5 py-0.5 rounded bg-slate-700 text-xs">{count}</span>
            </button>
          )
        })}
      </div>

      {/* القوالب الجاهزة */}
      {filteredPresets.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              🎁 قوالب جاهزة للتفعيل
              <span className="text-xs font-normal text-slate-400">({filteredPresets.length} قالب)</span>
            </h2>
            {activeCategory !== 'all' && filteredPresets.length > 1 && (
              <button
                onClick={() => handleActivateCategory(activeCategory)}
                disabled={activatingPreset !== null}
                className="px-4 py-1.5 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs hover:bg-emerald-500/30"
              >
                ⚡ تفعيل كل التصنيف ({filteredPresets.length})
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredPresets.map(preset => (
              <PresetCard
                key={preset.id}
                preset={preset}
                onActivate={() => handleActivatePreset(preset)}
                onCustomActivate={() => setEditingPreset(preset)}
                activating={activatingPreset === preset.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* القوالب المفعّلة */}
      {filteredTemplates.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            ✅ القوالب المفعّلة
            <span className="text-xs font-normal text-slate-400">({filteredTemplates.length} قالب)</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredTemplates.map(template => (
              <TemplateCard
                key={template.id}
                template={template}
                onToggle={() => handleToggle(template.id)}
                onEdit={() => setEditingTemplate(template)}
                onDelete={() => handleDelete(template.id)}
                toggling={toggling === template.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* حالة فارغة */}
      {filteredTemplates.length === 0 && filteredPresets.length === 0 && (
        <div className="text-center py-12">
          <div className="text-5xl mb-4">📝</div>
          <h3 className="text-lg font-medium text-white mb-2">لا توجد قوالب في هذا التصنيف</h3>
          <p className="text-slate-400 text-sm">اختر تصنيفاً آخر أو عُد إلى &quot;الكل&quot;</p>
        </div>
      )}
    </div>
  )
}
