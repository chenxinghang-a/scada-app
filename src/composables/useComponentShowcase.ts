/**
 * 组件库展示 Composable
 * 组件文档+示例，支持实时预览。
 *
 * 用法:
 *   const { components, getComponent, searchComponents } = useComponentShowcase()
 */

import { ref, computed } from 'vue'

interface ComponentExample {
  title: string
  code: string
  description?: string
}

interface ComponentDoc {
  name: string
  category: string
  description: string
  props: Array<{ name: string; type: string; default?: string; description: string }>
  events: Array<{ name: string; description: string }>
  slots: Array<{ name: string; description: string }>
  examples: ComponentExample[]
  tags: string[]
}

const componentDocs: ComponentDoc[] = [
  {
    name: 'StatCard',
    category: '数据展示',
    description: '统计卡片组件，展示关键指标数据',
    props: [
      { name: 'title', type: 'string', description: '卡片标题' },
      { name: 'value', type: 'string | number', description: '指标值' },
      { name: 'icon', type: 'string', description: '图标名称' },
      { name: 'trend', type: "'up' | 'down' | 'stable'", description: '趋势方向' },
    ],
    events: [],
    slots: [{ name: 'default', description: '自定义内容' }],
    examples: [
      { title: '基础用法', code: '<StatCard title="设备总数" value="42" icon="monitor" />' },
      { title: '带趋势', code: '<StatCard title="在线率" value="98.5%" trend="up" />' },
    ],
    tags: ['数据', '卡片', '统计'],
  },
  {
    name: 'SkeletonScreen',
    category: '反馈',
    description: '骨架屏加载组件，替代空白页面',
    props: [
      { name: 'type', type: "'text' | 'title' | 'avatar' | 'image' | 'button' | 'card' | 'table-row'", description: '骨架类型' },
      { name: 'width', type: 'string', default: '100%', description: '宽度' },
      { name: 'animate', type: 'boolean', default: 'true', description: '是否动画' },
    ],
    events: [],
    slots: [],
    examples: [
      { title: '文本骨架', code: '<SkeletonScreen type="text" width="60%" />' },
      { title: '卡片骨架', code: '<SkeletonScreen type="card" />' },
    ],
    tags: ['加载', '骨架屏', '占位'],
  },
  {
    name: 'VirtualList',
    category: '数据展示',
    description: '虚拟滚动列表，大数据量高性能渲染',
    props: [
      { name: 'items', type: 'any[]', description: '数据列表' },
      { name: 'itemHeight', type: 'number', default: '48', description: '每项高度' },
      { name: 'height', type: 'number', default: '600', description: '容器高度' },
      { name: 'buffer', type: 'number', default: '5', description: '缓冲区大小' },
    ],
    events: [],
    slots: [{ name: 'default', description: '列表项模板' }],
    examples: [
      { title: '基础用法', code: '<VirtualList :items="data" :item-height="48" :height="600"><template #default="{ item }"><div>{{ item.name }}</div></template></VirtualList>' },
    ],
    tags: ['列表', '虚拟滚动', '性能'],
  },
  {
    name: 'ErrorBoundary',
    category: '反馈',
    description: '错误边界组件，捕获子组件错误并展示降级UI',
    props: [
      { name: 'fallback', type: 'string', description: '降级UI文本' },
    ],
    events: [],
    slots: [{ name: 'default', description: '受保护的内容' }],
    examples: [
      { title: '基础用法', code: '<ErrorBoundary><MyComponent /></ErrorBoundary>' },
    ],
    tags: ['错误', '边界', '容错'],
  },
]

export function useComponentShowcase() {
  const components = ref<ComponentDoc[]>(componentDocs)
  const selectedCategory = ref<string>('all')
  const searchQuery = ref('')

  const categories = computed(() => {
    const cats = new Set(components.value.map(c => c.category))
    return ['all', ...Array.from(cats)]
  })

  const filteredComponents = computed(() => {
    let result = components.value

    if (selectedCategory.value !== 'all') {
      result = result.filter(c => c.category === selectedCategory.value)
    }

    if (searchQuery.value) {
      const query = searchQuery.value.toLowerCase()
      result = result.filter(c =>
        c.name.toLowerCase().includes(query) ||
        c.description.toLowerCase().includes(query) ||
        c.tags.some(t => t.toLowerCase().includes(query))
      )
    }

    return result
  })

  function getComponent(name: string): ComponentDoc | undefined {
    return components.value.find(c => c.name === name)
  }

  function searchComponents(query: string): ComponentDoc[] {
    const q = query.toLowerCase()
    return components.value.filter(c =>
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q) ||
      c.tags.some(t => t.toLowerCase().includes(q))
    )
  }

  function setCategory(category: string) {
    selectedCategory.value = category
  }

  return {
    components,
    categories,
    selectedCategory,
    searchQuery,
    filteredComponents,
    getComponent,
    searchComponents,
    setCategory,
  }
}
