"use client";

import { useState, useEffect, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Timeline } from '@/components/Timeline';
import { ApiSettings } from '@/components/ApiSettings';
import { ApiProvider, useApi } from '@/contexts/ApiContext';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import type { TimelineData, TimelineEvent, DateFilterOption, DateFilterConfig } from '@/types';
import { fetchTimelineData, fetchEventDetails, type ProgressCallback, type StreamCallback } from '@/lib/api';
import { SearchProgress, type SearchProgressStep } from '@/components/SearchProgress';
import { BaiduHotList } from '@/components/BaiduHotList';
import { HotSearchDropdown } from '@/components/HotSearchDropdown';
import { toast } from 'sonner';
import { Settings, SortDesc, SortAsc, Download, Search, ChevronDown, Flame } from 'lucide-react';

function MainContent() {
  const { apiConfig, isConfigured, isPasswordProtected, isPasswordValidated } = useApi();
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [timelineData, setTimelineData] = useState<TimelineData>({ events: [] });
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState('');
  const [showFloatingButton, setShowFloatingButton] = useState(false);
  const [dateFilter, setDateFilter] = useState<DateFilterConfig>({ option: 'all' });
  const [filteredEvents, setFilteredEvents] = useState<TimelineEvent[]>([]);
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // 新增的状态用于控制搜索框位置和时间轴可见性
  const [searchPosition, setSearchPosition] = useState<'center' | 'top'>('center');
  const [timelineVisible, setTimelineVisible] = useState(false);
  const searchRef = useRef<HTMLFormElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 新增进度状态
  const [searchProgressVisible, setSearchProgressVisible] = useState(false);
  const [searchProgressSteps, setSearchProgressSteps] = useState<SearchProgressStep[]>([]);
  const [searchProgressActive, setSearchProgressActive] = useState(false);

  // 热搜状态
  const [showHotList, setShowHotList] = useState(false); // 保留原有热搜弹窗
  const [showHotSearch, setShowHotSearch] = useState(true); // 搜索框下方热搜下拉
  const [flyingHotItem, setFlyingHotItem] = useState<{ title: string, startX: number, startY: number } | null>(null);

  // 新增搜索耗时和结果数状态
  const [searchStartTime, setSearchStartTime] = useState<number | null>(null);
  const [searchTimeElapsed, setSearchTimeElapsed] = useState<number | null>(null);

  // 进度回调函数
  const progressCallback: ProgressCallback = (message, status) => {
    const newStep: SearchProgressStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      message,
      status,
      timestamp: new Date()
    };

    setSearchProgressSteps(prev => [...prev, newStep]);

    if (status !== 'pending') {
      // 结束或错误时不再激活
    } else {
      setSearchProgressActive(true);
    }
  };

  const scrollToTimeline = () => {
    if (timelineRef.current) {
      const header = document.querySelector('header');
      const headerHeight = header?.offsetHeight || 0;
      const yOffset = -headerHeight - 20;
      const y = timelineRef.current.getBoundingClientRect().top + window.scrollY + yOffset;

      window.scrollTo({
        top: y,
        behavior: 'smooth'
      });
    }
  };

  // 热搜点击（兼容飞行动画）
  const handleHotItemClick = (title: string) => {
    // 获取热搜项的位置
    const hotItems = document.querySelectorAll('.hot-item');
    let startX = 0;
    let startY = 0;

    hotItems.forEach((item) => {
      if (item.textContent?.includes(title)) {
        const rect = item.getBoundingClientRect();
        startX = rect.left + rect.width / 2;
        startY = rect.top + rect.height / 2;
      }
    });

    setFlyingHotItem({ title, startX, startY });

    setTimeout(() => {
      setQuery(title);
      setShowHotList(false);
      setFlyingHotItem(null);
      setShowHotSearch(false); // 隐藏下拉热搜

      setTimeout(() => {
        if (inputRef.current) {
          const form = inputRef.current.form;
          if (form) {
            form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
          }
        }
      }, 300);
    }, 600);
  };

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 150) {
        setShowFloatingButton(true);
      } else {
        setShowFloatingButton(false);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (timelineData.events.length === 0) {
      setFilteredEvents([]);
      return;
    }

    const now = new Date();
    let startDate: Date | undefined;

    switch (dateFilter.option) {
      case 'month':
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'halfYear':
        startDate = new Date(now);
        startDate.setMonth(now.getMonth() - 6);
        break;
      case 'year':
        startDate = new Date(now);
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      case 'custom':
        startDate = dateFilter.startDate;
        break;
      default:
        setFilteredEvents(sortEvents(timelineData.events));
        return;
    }

    const endDate = dateFilter.option === 'custom' ? dateFilter.endDate : undefined;

    const filtered = timelineData.events.filter(event => {
      const dateParts = event.date.split('-').map(Number);
      let eventDate: Date;

      if (dateParts.length === 3) {
        eventDate = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
      } else if (dateParts.length === 2) {
        eventDate = new Date(dateParts[0], dateParts[1] - 1, 1);
      } else if (dateParts.length === 1) {
        eventDate = new Date(dateParts[0], 0, 1);
      } else {
        return true;
      }

      if (startDate && eventDate < startDate) {
        return false;
      }
      if (endDate && eventDate > endDate) {
        return false;
      }
      return true;
    });

    setFilteredEvents(sortEvents(filtered));
  }, [timelineData.events, dateFilter, sortDirection]);

  useEffect(() => {
    if (flyingHotItem && inputRef.current) {
      const inputRect = inputRef.current.getBoundingClientRect();
      const inputCenterX = inputRect.left + inputRect.width / 2;
      const inputCenterY = inputRect.top + inputRect.height / 2;

      const flyX = inputCenterX - flyingHotItem.startX;
      const flyY = inputCenterY - flyingHotItem.startY;

      document.documentElement.style.setProperty('--fly-x', `${flyX}px`);
      document.documentElement.style.setProperty('--fly-y', `${flyY}px`);
    }
  }, [flyingHotItem]);

  // 自动显示热搜下拉（仅在搜索框为空且聚焦时）
  useEffect(() => {
    if (!query.trim()) {
      setShowHotSearch(true);
    }
  }, [query]);

  // 优化逻辑：只要query有内容就隐藏热搜
  useEffect(() => {
    if (query.trim()) {
      setShowHotSearch(false);
    }
  }, [query]);

  // 有搜索结果时隐藏热搜
  useEffect(() => {
    if (timelineVisible && timelineData.events.length > 0) {
      setShowHotSearch(false);
    }
  }, [timelineVisible, timelineData.events.length]);

  const sortEvents = (events: TimelineEvent[]): TimelineEvent[] => {
    return [...events].sort((a, b) => {
      const dateA = a.date.replace(/\D/g, '');
      const dateB = b.date.replace(/\D/g, '');
      return sortDirection === 'asc'
        ? dateA.localeCompare(dateB)
        : dateB.localeCompare(dateA);
    });
  };

  const toggleSortDirection = () => {
    setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!query.trim()) {
      toast.warning('请输入搜索关键词');
      return;
    }

    if (!isConfigured) {
      toast.info('请先配置API设置');
      setShowSettings(true);
      return;
    }

    if (isPasswordProtected && !isPasswordValidated) {
      toast.info('请先验证访问密码');
      setShowSettings(true);
      return;
    }

    // 隐藏热搜榜
    setShowHotList(false);
    setShowHotSearch(false);  // 确保搜索时隐藏热搜列表

    // 重置进度显示
    setSearchProgressSteps([]);
    setSearchProgressActive(true);
    setSearchProgressVisible(true);

    // 记录搜索开始时间
    setSearchStartTime(Date.now());
    setSearchTimeElapsed(null);

    // 如果搜索框在中央，则先将其移动到顶部
    if (searchPosition === 'center') {
      setSearchPosition('top');
      setTimeout(() => {
        fetchData();
      }, 700);
    } else {
      fetchData();
    }
  };

  const fetchData = async () => {
    setIsLoading(true);
    setError('');
    // 仅在第一次搜索时才设置timelineVisible为false
    // 如果已经有搜索结果，则保持timelineVisible不变
    if (timelineData.events.length === 0) {
      setTimelineVisible(false);
    }

    try {
      let queryWithDateFilter = query;

      if (dateFilter.option !== 'all') {
        let dateRangeText = '';
        const now = new Date();

        switch(dateFilter.option) {
          case 'month':
            const monthAgo = new Date(now);
            monthAgo.setMonth(now.getMonth() - 1);
            dateRangeText = `，请主要搜索 ${formatDate(monthAgo)} 至 ${formatDate(now)} 这段时间的内容`;
            break;
          case 'halfYear':
            const halfYearAgo = new Date(now);
            halfYearAgo.setMonth(now.getMonth() - 6);
            dateRangeText = `，请主要搜索 ${formatDate(halfYearAgo)} 至 ${formatDate(now)} 这段时间的内容`;
            break;
          case 'year':
            const yearAgo = new Date(now);
            yearAgo.setFullYear(now.getFullYear() - 1);
            dateRangeText = `，请主要搜索 ${formatDate(yearAgo)} 至 ${formatDate(now)} 这段时间的内容`;
            break;
          case 'custom':
            if (dateFilter.startDate && dateFilter.endDate) {
              dateRangeText = `，请主要搜索 ${formatDate(dateFilter.startDate)} 至 ${formatDate(dateFilter.endDate)} 这段时间的内容`;
            }
            break;
        }

        queryWithDateFilter += dateRangeText;
      }

      const streamCallback: StreamCallback = (chunk, isDone) => {
        console.log('收到流式数据块:', chunk.substring(0, 50) + (chunk.length > 50 ? '...' : ''));
      };

      const data = await fetchTimelineData(queryWithDateFilter, apiConfig, progressCallback, streamCallback);
      setTimelineData(data);

      // 计算搜索耗时
      if (searchStartTime) {
        setSearchTimeElapsed(Date.now() - searchStartTime);
      }

      setTimeout(() => {
        setTimelineVisible(true);
        if (data.events.length > 0) {
          setTimeout(scrollToTimeline, 300);
        }

        setSearchProgressActive(false);

        // 不再自动隐藏搜索进度框
        // setTimeout(() => {
        //   setSearchProgressVisible(false);
        // }, 3000);

      }, 300);

      if (data.events.length === 0) {
        toast.warning('未找到相关事件，请尝试其他关键词');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '发生错误，请稍后再试';
      setError(errorMessage);
      toast.error(errorMessage);
      console.error('Error fetching timeline data:', err);

      setSearchProgressActive(false);

      // 计算搜索耗时(即使出错)
      if (searchStartTime) {
        setSearchTimeElapsed(Date.now() - searchStartTime);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (date: Date | undefined): string => {
    if (!date) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

  const handleDateFilterChange = (value: DateFilterOption) => {
    if (value === 'custom') {
      setDateFilter({
        option: value,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined
      });
    } else {
      setDateFilter({ option: value });
    }
  };

  const handleStartDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setStartDate(e.target.value);
    if (dateFilter.option === 'custom' && e.target.value) {
      setDateFilter({
        ...dateFilter,
        startDate: new Date(e.target.value)
      });
    }
  };

  const handleEndDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEndDate(e.target.value);
    if (dateFilter.option === 'custom' && e.target.value) {
      setDateFilter({
        ...dateFilter,
        endDate: new Date(e.target.value)
      });
    }
  };

  const handleRequestDetails = async (event: TimelineEvent, streamCallback?: StreamCallback): Promise<string> => {
    if (!isConfigured) {
      toast.info('请先配置API设置');
      setShowSettings(true);
      return '请先配置API设置';
    }

    if (isPasswordProtected && !isPasswordValidated) {
      toast.info('请先验证访问密码');
      setShowSettings(true);
      return '请先验证访问密码';
    }

    setSearchProgressSteps([]);
    setSearchProgressActive(true);
    setSearchProgressVisible(true);

    // 记录搜索开始时间
    setSearchStartTime(Date.now());
    setSearchTimeElapsed(null);

    try {
      const detailedQuery = `事件：${event.title}（${event.date}）\n\n请提供该事件的详细分析，包括事件背景、主要过程、关键人物、影响与意义。请尽可能提供多方观点，并分析该事件在${query}整体发展中的位置与作用。`;

      const detailsContent = await fetchEventDetails(
        event.id,
        detailedQuery,
        apiConfig,
        progressCallback,
        streamCallback
      );

      // 计算搜索耗时
      if (searchStartTime) {
        setSearchTimeElapsed(Date.now() - searchStartTime);
      }

      // 不自动隐藏进度
      setTimeout(() => {
        // setSearchProgressVisible(false);
        setSearchProgressActive(false);
      }, 1000);

      return detailsContent;
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '获取详细信息失败';
      toast.error(errorMessage);
      console.error('Error fetching event details:', err);

      setSearchProgressActive(false);

      // 计算搜索耗时(即使出错)
      if (searchStartTime) {
        setSearchTimeElapsed(Date.now() - searchStartTime);
      }

      return '获取详细信息失败，请稍后再试';
    }
  };

  const exportAsImage = () => {
    if (filteredEvents.length === 0) {
      toast.warning('没有可导出的内容');
      return;
    }

    import('html2canvas').then(({ default: html2canvas }) => {
      const timelineElement = document.querySelector('.timeline-container') as HTMLElement;
      if (!timelineElement) {
        toast.error('找不到时间轴元素');
        return;
      }

      toast.info('正在生成图片，请稍候...');

      html2canvas(timelineElement, {
        scale: 2,
        logging: false,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff'
      }).then(canvas => {
        const fileName = `一线-${query.replace(/\s+/g, '-')}-${new Date().toISOString().slice(0, 10)}.png`;
        const link = document.createElement('a');
        link.download = fileName;
        link.href = canvas.toDataURL('image/png');
        link.click();

        toast.success('图片已导出');
      }).catch(err => {
        console.error('Error exporting image:', err);
        toast.error('导出图片失败');
      });
    }).catch(err => {
      console.error('Error loading html2canvas:', err);
      toast.error('加载导出功能失败');
    });
  };

  // 保留弹窗热搜榜切换函数（兼容旧逻辑）
  const toggleHotList = () => {
    setShowHotList(prev => !prev);
  };

  return (
    <main className="flex min-h-screen flex-col relative">
      {/* 背景渐变装饰 */}
      <div className="bg-gradient-purple" />
      <div className="bg-gradient-blue" />

      {/* 头部 - 位于顶部固定不动 */}
      <header className="fixed top-0 left-0 w-full z-20 flex justify-end items-center p-4 md:px-8">
        <div className="flex gap-2">
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowSettings(true)}
            className="rounded-full"
          >
            <Settings size={20} />
          </Button>
        </div>
      </header>

      {/* 搜索表单 - 可以在中央和顶部之间切换 */}
      <form
        ref={searchRef}
        onSubmit={handleSubmit}
        className={searchPosition === 'center' ? 'search-container-center' : 'search-container-top'}
      >
        {searchPosition === 'center' && (
          <div className="flex flex-col items-center mb-8 animate-slide-down">
            <h1 className="text-4xl md:text-5xl font-bold mb-4 text-center page-title">一线</h1>
            <p className="text-lg md:text-xl text-muted-foreground mb-8 text-center max-w-xl mx-auto">
              AI驱动的热点事件时间轴 · 洞察历史脉络
            </p>
          </div>
        )}

        <div className="p-4 w-full">
          <div className="glass-card rounded-full overflow-hidden flex items-center p-1 pr-2">
            <Input
              ref={inputRef}
              type="text"
              placeholder="输入关键词，如：俄乌冲突、中美贸易..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 border-0 bg-transparent focus-visible:ring-0 placeholder:text-muted-foreground/70"
              onFocus={() => { if (!query.trim()) setShowHotSearch(true); }}
              // 取消onBlur事件，避免用户无法点击热搜项
            />

            <div className="flex items-center">
              {/* 移除热搜榜按钮，热搜自动显示在下方 */}
              <Select
                value={dateFilter.option}
                onValueChange={handleDateFilterChange as (value: string) => void}
                defaultValue="all"
              >
                <SelectTrigger className="w-auto border-0 bg-transparent mr-2 focus:ring-0">
                  <div className="flex items-center">
                    <ChevronDown size={14} className="mr-1 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">
                      {dateFilter.option === 'all' && '所有时间'}
                      {dateFilter.option === 'month' && '近一个月'}
                      {dateFilter.option === 'halfYear' && '近半年'}
                      {dateFilter.option === 'year' && '近一年'}
                      {dateFilter.option === 'custom' && '自定义'}
                    </span>
                  </div>
                </SelectTrigger>
                <SelectContent className="glass-card border-0">
                  <SelectItem value="all">所有时间</SelectItem>
                  <SelectItem value="month">近一个月</SelectItem>
                  <SelectItem value="halfYear">近半年</SelectItem>
                  <SelectItem value="year">近一年</SelectItem>
                  <SelectItem value="custom">自定义</SelectItem>
                </SelectContent>
              </Select>

              <Button
                type="submit"
                size="icon"
                disabled={isLoading}
                className="rounded-full aspect-square h-9 w-9 bg-primary hover:bg-primary/90"
              >
                {isLoading ?
                  <div className="loading-spinner" /> :
                  <Search size={16} />
                }
              </Button>
            </div>
          </div>

          {/* 自定义日期范围输入 */}
          {dateFilter.option === 'custom' && (
            <div className="flex flex-col sm:flex-row gap-2 mt-3 glass p-3 rounded-xl">
              <div className="flex-1 flex gap-2 items-center">
                <label htmlFor="start-date" className="text-sm whitespace-nowrap">开始日期:</label>
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={handleStartDateChange}
                  className="flex-1 glass-input text-sm h-8"
                />
              </div>
              <div className="flex-1 flex gap-2 items-center">
                <label htmlFor="end-date" className="text-sm whitespace-nowrap">结束日期:</label>
                <Input
                  id="end-date"
                  type="date"
                  value={endDate}
                  onChange={handleEndDateChange}
                  className="flex-1 glass-input text-sm h-8"
                />
              </div>
            </div>
          )}

          {/* 热搜下拉列表 - 在搜索框下方显示，确保不会因为展开而影响已生成内容 */}
          <div className="w-full mx-auto relative z-30">
            <HotSearchDropdown
              visible={searchPosition === 'center' && showHotSearch && !isLoading && !timelineVisible}
              onSelectHotItem={handleHotItemClick}
            />
          </div>

          {/* 搜索进度显示 - 移到输入框下方，宽度与搜索框对齐 */}
          <div className="w-full mx-auto mt-4 transition-all duration-300">
            <SearchProgress
              steps={searchProgressSteps}
              visible={searchProgressVisible}
              isActive={searchProgressActive}
              timeElapsed={searchTimeElapsed || undefined}
              resultCount={filteredEvents.length || undefined}
            />
          </div>
        </div>
      </form>

      {/* 保留原来的百度热搜榜弹窗，以便保留兼容性 */}
      <BaiduHotList
        visible={showHotList}
        onClose={() => setShowHotList(false)}
        onSelectHotItem={handleHotItemClick}
      />

      {/* 飞行热搜项 */}
      {flyingHotItem && (
        <div
          className="fixed z-50 fly-to-input bg-primary text-primary-foreground px-3 py-1.5 rounded-full text-sm font-medium"
          style={{
            left: flyingHotItem.startX,
            top: flyingHotItem.startY,
            transform: 'translate(-50%, -50%)'
          }}
        >
          {flyingHotItem.title}
        </div>
      )}

      {/* 移除原有位置的搜索进度显示 */}
      {/* <div className={`fixed bottom-4 left-0 right-0 w-full max-w-3xl mx-auto px-4 transition-opacity duration-300 ${searchProgressVisible ? 'opacity-100' : 'opacity-0'}`}
           style={{zIndex: 40}}>
        <SearchProgress
          steps={searchProgressSteps}
          visible={searchProgressVisible}
          isActive={searchProgressActive}
        />
      </div> */}

      {/* 时间轴容器 - 调整了距离顶部的间距，使其在搜索栏展开时仍然可见 */}
      <div className="flex-1 pt-28 pb-12 px-4 md:px-8 w-full max-w-6xl mx-auto">
        {(timelineVisible || isLoading) && (
          <div
            ref={timelineRef}
            className={`timeline-container ${timelineVisible ? 'timeline-container-visible' : ''}`}
          >
            {error && (
              <div className="mb-6 sm:mb-8 p-3 sm:p-4 glass text-red-500 dark:text-red-300 rounded-lg text-sm sm:text-base">
                {error}
              </div>
            )}

            {filteredEvents.length > 0 && (
              <div className="flex justify-between mb-4 glass rounded-lg p-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleSortDirection}
                  className="flex items-center gap-1 rounded-full text-xs"
                >
                  {sortDirection === 'asc' ? (
                    <>
                      <SortAsc size={14} /> 从远到近
                    </>
                  ) : (
                    <>
                      <SortDesc size={14} /> 从近到远
                    </>
                  )}
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={exportAsImage}
                  className="flex items-center gap-1 rounded-full text-xs"
                >
                  <Download size={14} /> 导出图片
                </Button>
              </div>
            )}

            <Timeline
              events={filteredEvents}
              isLoading={isLoading}
              onRequestDetails={handleRequestDetails}
              summary={timelineData.summary}
            />
          </div>
        )}
      </div>

      <ApiSettings
        open={showSettings}
        onOpenChange={setShowSettings}
      />

      {/* Floating API settings button */}
      {showFloatingButton && (
        <Button
          variant="secondary"
          size="sm"
          className="fixed bottom-4 right-4 z-50 rounded-full p-3 shadow-md sm:hidden glass"
          onClick={() => setShowSettings(true)}
        >
          <Settings size={20} />
        </Button>
      )}
    </main>
  );
}

export default function Home() {
  return (
    <ApiProvider>
      <MainContent />
    </ApiProvider>
  );
}
