<template>
  <div class="erp-page">
    <a-card class="content-card" :bordered="false">
      <PageSummaryStrip :items="summaryItems" />
      <template #title>生产制单</template>

      <MobileFilterPanel>
        <template #filters>
          <a-input
            v-model:value="keywordInput"
            placeholder="搜索制单号 / 成衣编号 / 成衣名称 / 加工厂 / 备注"
            allow-clear
            style="width: 320px"
          />
          <a-select v-model:value="factoryFilter" :options="factoryFilterOptions" allow-clear placeholder="加工厂" style="width: 180px" />
          <a-select v-model:value="statusFilter" :options="statusFilterOptions" allow-clear placeholder="生产状态" style="width: 140px" />
          <a-select
            v-model:value="documentStatusFilter"
            :options="documentStatusOptions"
            allow-clear
            placeholder="单据状态"
            style="width: 140px"
          />
          <a-select v-model:value="sortField" :options="sortFieldOptions" placeholder="排序字段" style="width: 150px" />
          <a-select v-model:value="sortOrder" :options="sortOrderOptions" placeholder="排序方向" style="width: 120px" />
          <a-range-picker v-model:value="dateRange" value-format="YYYY-MM-DD" :placeholder="['开始日期', '结束日期']" style="width: 260px" />
          <a-input-number v-model:value="lossThresholdPercent" :min="0" :step="0.1" style="width: 120px" />
          <a-checkbox v-model:checked="onlyWarnings">仅看异常</a-checkbox>
          <a-select
            v-model:value="batchDocumentStatus"
            :options="quickDocumentStatusOptions"
            placeholder="改单据状态"
            style="width: 140px"
          />
          <a-button :disabled="!selectedRowKeys.length || !batchDocumentStatus" @click="applyBatchDocumentStatus">批量改单据状态</a-button>
          <a-button :disabled="!selectedRowKeys.length" @click="handleBatchAudit">批量审核</a-button>
          <a-button :disabled="!selectedRowKeys.length" @click="returnProductionToDraft()">批量退回草稿</a-button>
          <a-button danger :disabled="!selectedRowKeys.length" @click="voidProductionOrders()">批量作废</a-button>
          <a-button danger :disabled="!selectedRowKeys.length" @click="handleBatchDelete">批量删除</a-button>
          <a-checkbox v-model:checked="exportIncludeProcessFee">导出加工费</a-checkbox>
          <a-dropdown>
            <a-button :disabled="!selectedRowKeys.length">批量导出</a-button>
            <template #overlay>
              <a-menu @click="({ key }) => handleBatchExport(key)">
                <a-menu-item key="pdf">PDF</a-menu-item>
                <a-menu-item key="excel">Excel</a-menu-item>
                <a-menu-item key="image">图片</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </template>
        <template #actions>
          <a-button class="toolbar-refresh-btn" @click="refreshPage">刷新</a-button>
          <a-button type="primary" @click="openCreate">新增生产单</a-button>
        </template>
      </MobileFilterPanel>

      <div class="erp-table-caption">
        支持按加工厂、生产状态、单据状态和异常损耗快速筛单；草稿阶段可先建单，提交后再按真实库存校验。
      </div>

    <div v-if="isMobileLayout" class="erp-mobile-list">
      <div
        v-for="record in filteredList"
        :key="record.id"
        class="erp-mobile-card"
        :class="{ 'erp-mobile-card--voided': record.document_status === 'voided' }"
        >
        <div class="erp-mobile-card__head">
          <div>
            <div class="erp-mobile-card__title">{{ record.order_no }}</div>
            <div class="erp-mobile-card__meta">{{ record.style_code }}{{ record.garment_name ? ` / ${record.garment_name}` : '' }}</div>
          </div>
          <a-tag :color="documentStatusColor(record.document_status)">{{ documentStatusLabel(record.document_status) }}</a-tag>
        </div>
        <div class="erp-mobile-card__section">
          <div class="erp-mobile-card__label">加工信息</div>
          <div class="erp-mobile-card__value">{{ record.factory_name || '-' }}</div>
          <div class="erp-mobile-card__sub">生产状态：{{ record.status || '-' }}</div>
        </div>
        <div class="erp-mobile-card__grid">
          <div class="erp-mobile-card__stat">
            <div class="erp-mobile-card__label">待生产</div>
            <div class="erp-mobile-card__value">{{ formatQty(record.quantity) }}</div>
          </div>
          <div class="erp-mobile-card__stat">
            <div class="erp-mobile-card__label">生产中</div>
            <div class="erp-mobile-card__value">{{ formatQty(record.cut_output_qty) }}</div>
          </div>
          <div class="erp-mobile-card__stat">
            <div class="erp-mobile-card__label">已完成</div>
            <div class="erp-mobile-card__value">{{ formatQty(record.actual_output_qty) }}</div>
          </div>
        </div>
        <div class="erp-mobile-card__sub">阶段单件成本：{{ formatMoney(record.actual_unit_cost, 4) }}/件</div>
        <div class="erp-mobile-card__sub">
          下单：{{ record.pending_date || String(record.created_at || '').slice(0, 10) || '-' }}
          · 裁床：{{ record.cut_date || '-' }}
          · 出货：{{ record.completed_date || '-' }}
        </div>
        <div v-if="isWarning(record)" class="erp-mobile-card__warning">
          损耗异常：{{ formatLossPercent(record.cut_loss_rate) }}
        </div>
        <div class="erp-mobile-card__footer">
          <a-button size="small" @click="openDetail(record)">详情</a-button>
          <a-button size="small" @click="openCopy(record)">复制</a-button>
          <a-button v-if="!isLockedDocument(record.document_status)" size="small" @click="openEdit(record)">编辑</a-button>
          <a-button size="small" type="primary" @click="openAuditModal(record)">审核</a-button>
        </div>
      </div>
    </div>

    <a-table
      v-else
      class="erp-dense-table"
      :data-source="filteredList"
      :columns="columns"
      :row-key="(row) => row.id"
      :row-class-name="getProductionRowClassName"
      :pagination="{ pageSize: 12, showSizeChanger: true, pageSizeOptions: ['12', '24', '50'] }"
      :scroll="{ x: 1500 }"
      size="small"
      :loading="listLoading"
      :row-selection="rowSelection"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'garment'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">{{ record.garment_name ? `${record.style_code} / ${record.garment_name}` : record.style_code }}</div>
            <div class="table-secondary">制衣厂：{{ record.factory_name || '-' }}</div>
            <div class="table-secondary">交期：{{ record.delivery_date || '-' }}</div>
            <div class="table-secondary">创建：{{ String(record.created_at || '').slice(0, 10) || '-' }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'qty'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">待生产：{{ formatQty(record.quantity) }}</div>
            <div class="table-secondary">生产中：{{ formatQty(record.cut_output_qty) }}</div>
            <div class="table-secondary">已完成：{{ formatQty(record.actual_output_qty) }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'status'">
          <div class="table-stack table-stack--tight">
            <a-select :value="record.status" :options="statusFilterOptions" size="small" style="width: 120px" @change="(value) => handleQuickStatus(record, value)" />
            <a-tag :color="documentStatusColor(record.document_status)">{{ documentStatusLabel(record.document_status) }}</a-tag>
            <a-tag v-if="isWarning(record)" color="red">损耗{{ formatLossPercent(record.cut_loss_rate) }}</a-tag>
          </div>
        </template>

        <template v-else-if="column.key === 'cost'">
          <div class="table-stack table-stack--tight">
            <div class="table-secondary">原料：{{ formatMoney(record.material_cost, 2) }}</div>
            <div class="table-secondary">加工：{{ formatMoney(record.process_cost, 2) }}</div>
            <div class="table-emphasis">阶段单件：{{ formatMoney(record.actual_unit_cost, 4) }}/件</div>
          </div>
        </template>

        <template v-else-if="column.key === 'dates'">
          <div class="table-stack table-stack--tight">
            <div class="table-primary">下单：{{ record.pending_date || String(record.created_at || '').slice(0, 10) || '-' }}</div>
            <div class="table-secondary">裁床：{{ record.cut_date || '-' }}</div>
            <div class="table-secondary">出货：{{ record.completed_date || '-' }}</div>
          </div>
        </template>

        <template v-else-if="column.key === 'action'">
          <a-space>
            <a-select
              v-if="!isLockedDocument(record.document_status)"
              size="small"
              style="width: 100px"
              :value="record.document_status"
              :options="quickDocumentStatusOptions"
              placeholder="改单据状态"
              @change="(value) => updateSingleDocumentStatus(record, value)"
            />
            <a-button size="small" type="primary" @click="openAuditModal(record)">审核</a-button>
            <a-button v-if="record.document_status !== 'draft'" size="small" @click="returnProductionToDraft([record.id])">退回草稿</a-button>
            <a-button v-if="record.document_status !== 'approved'" size="small" danger @click="voidProductionOrders([record.id])">作废</a-button>
            <a-dropdown>
              <a-button size="small">导出</a-button>
              <template #overlay>
                <a-menu @click="({ key }) => handleExport(record, key)">
                  <a-menu-item key="pdf">PDF</a-menu-item>
                  <a-menu-item key="excel">Excel</a-menu-item>
                  <a-menu-item key="image">图片</a-menu-item>
                </a-menu>
              </template>
            </a-dropdown>
            <a-button size="small" @click="openDetail(record)">详情</a-button>
            <a-button size="small" @click="openCopy(record)">复制</a-button>
            <a-button v-if="!isLockedDocument(record.document_status)" size="small" @click="openEdit(record)">编辑</a-button>
            <a-popconfirm v-if="!isLockedDocument(record.document_status)" title="确认删除该生产单？" @confirm="remove(record.id)">
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="visible"
      :title="viewMode ? '生产单详情' : (form.id ? '编辑生产单' : '新增生产单')"
      width="1180px"
      :footer="viewMode ? null : undefined"
      :confirm-loading="saving"
      @ok="save"
    >
      <div :style="viewMode ? 'pointer-events:none; opacity:0.96;' : ''">
        <div v-if="viewMode" class="detail-top-panel">
          <div class="detail-top-panel__grid">
            <div class="detail-top-panel__item">
              <div class="detail-top-panel__label">制单号</div>
              <div class="detail-top-panel__value">{{ form.order_no || '-' }}</div>
            </div>
            <div class="detail-top-panel__item">
              <div class="detail-top-panel__label">成衣</div>
              <div class="detail-top-panel__value">{{ selectedGarment?.style_code || '-' }}{{ selectedGarment?.name ? ` / ${selectedGarment.name}` : '' }}</div>
            </div>
            <div class="detail-top-panel__item">
              <div class="detail-top-panel__label">加工厂</div>
              <div class="detail-top-panel__value">{{ form.factory_name || '-' }}</div>
            </div>
            <div class="detail-top-panel__item">
              <div class="detail-top-panel__label">生产状态</div>
              <div class="detail-top-panel__value">{{ form.status || '-' }}</div>
            </div>
            <div class="detail-top-panel__item">
              <div class="detail-top-panel__label">下单日期</div>
              <div class="detail-top-panel__value">{{ pendingDate || '-' }}</div>
            </div>
            <div class="detail-top-panel__item">
              <div class="detail-top-panel__label">裁床日期</div>
              <div class="detail-top-panel__value">{{ cutDate || '-' }}</div>
            </div>
            <div class="detail-top-panel__item">
              <div class="detail-top-panel__label">出货日期</div>
              <div class="detail-top-panel__value">{{ completedDate || '-' }}</div>
            </div>
            <div class="detail-top-panel__item">
              <div class="detail-top-panel__label">交期</div>
              <div class="detail-top-panel__value">{{ deliveryDate || '-' }}</div>
            </div>
          </div>
        </div>
        <a-form layout="vertical">
          <a-row :gutter="12">
            <a-col :span="6"><a-form-item label="制单号" required><a-input v-model:value="form.order_no" /></a-form-item></a-col>
            <a-col :span="6">
              <a-form-item label="成衣" required>
                <a-select v-model:value="form.garment_id" :options="garmentOptions" show-search option-filter-prop="label" @change="handleGarmentChange" />
              </a-form-item>
            </a-col>
            <a-col :span="6">
              <a-form-item label="加工厂">
                <InlineOptionSelect
                  v-model="form.factory_name"
                  :entries="optionLists.factories"
                  option-type="factory"
                  add-label="加工厂"
                  placeholder="选择加工厂"
                  allow-clear
                  @options-updated="handleOptionsUpdated"
                />
              </a-form-item>
            </a-col>
            <a-col :span="6"><a-form-item label="加工费(元/件)"><a-input-number v-model:value="form.process_fee" style="width: 100%" :min="0" /></a-form-item></a-col>
          </a-row>

          <a-row :gutter="12" v-if="selectedGarmentFactoryFeeOptions.length">
            <a-col :span="12">
              <a-form-item label="工厂加工费方案">
                <a-select
                  :value="selectedFactoryFeeKey"
                  :options="selectedGarmentFactoryFeeOptions"
                  placeholder="选择工厂加工费方案"
                  allow-clear
                  @change="applySelectedFactoryFee"
                />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="当前匹配结果">
                <a-input :value="currentFactoryFeeHint" readonly />
              </a-form-item>
            </a-col>
          </a-row>

          <a-row :gutter="12">
            <a-col :span="6"><a-form-item label="单据状态"><a-select v-model:value="form.document_status" :options="documentStatusOptions" /></a-form-item></a-col>
            <a-col :span="6"><a-form-item label="生产状态"><a-select :value="form.status" :options="statusFilterOptions" @change="handleFormStatusChange" /></a-form-item></a-col>
            <a-col :span="6"><a-form-item label="交期"><a-date-picker v-model:value="deliveryDate" value-format="YYYY-MM-DD" style="width: 100%" /></a-form-item></a-col>
            <a-col :span="6"><a-form-item label="加工费小计"><a-input :value="formatMoney(stageBaseQty * Number(form.process_fee || 0), 2)" readonly /></a-form-item></a-col>
          </a-row>
          <a-row :gutter="12">
            <a-col :span="8"><a-form-item label="下单日期"><a-date-picker v-model:value="pendingDate" value-format="YYYY-MM-DD" style="width: 100%" /></a-form-item></a-col>
            <a-col :span="8"><a-form-item label="裁床日期"><a-date-picker v-model:value="cutDate" value-format="YYYY-MM-DD" style="width: 100%" /></a-form-item></a-col>
            <a-col :span="8"><a-form-item label="出货日期"><a-date-picker v-model:value="completedDate" value-format="YYYY-MM-DD" style="width: 100%" /></a-form-item></a-col>
          </a-row>

          <div class="section-caption" style="margin-bottom: 10px;">
            <div>
              <div class="section-caption__title">待生产尺码分配</div>
              <div class="section-caption__desc">默认 S / M / L，可自定义新增。待生产数量自动汇总。</div>
            </div>
            <a-button v-if="!viewMode" size="small" @click="addSizeRow()">新增尺码</a-button>
          </div>
          <div class="size-grid">
            <div v-for="(item, index) in sizeRows" :key="item.key" class="size-grid__item">
              <a-input v-model:value="item.size" placeholder="灏虹爜" :disabled="viewMode" />
              <a-input-number v-model:value="item.qty" :min="0" style="width: 100%" :disabled="viewMode" />
              <a-button v-if="!viewMode" size="small" danger @click="removeSizeRow(index)">删除</a-button>
            </div>
          </div>
          <a-row :gutter="12" style="margin-top: 12px;">
            <a-col :span="8"><a-form-item label="待生产数量"><a-input :value="formatQty(quantityValue)" readonly /></a-form-item></a-col>
          </a-row>

          <template v-if="showProgressSection">
            <div class="section-caption" style="margin-bottom: 10px;">
              <div>
                <div class="section-caption__title">生产中尺码分配</div>
                <div class="section-caption__desc">状态为“生产中 / 已完成”时填写，数量自动汇总。</div>
              </div>
              <a-button v-if="!viewMode" size="small" @click="addCutSizeRow()">新增生产中尺码</a-button>
            </div>
            <div class="size-grid">
              <div v-for="(item, index) in cutSizeRows" :key="item.key" class="size-grid__item">
                <a-input v-model:value="item.size" placeholder="灏虹爜" :disabled="viewMode" />
                <a-input-number v-model:value="item.qty" :min="0" style="width: 100%" :disabled="viewMode" />
                <a-button v-if="!viewMode" size="small" danger @click="removeCutSizeRow(index)">删除</a-button>
              </div>
            </div>
            <a-row :gutter="12" style="margin-top: 12px;">
              <a-col :span="8"><a-form-item label="生产中数量"><a-input :value="formatQty(cutOutputValue)" readonly /></a-form-item></a-col>
            </a-row>
          </template>

          <template v-if="showCompletedSection">
            <div class="section-caption" style="margin-bottom: 10px;">
              <div>
                <div class="section-caption__title">已完成尺码分配</div>
                <div class="section-caption__desc">收货后填写，数量自动汇总，并据此计算完成阶段成本。</div>
              </div>
              <a-button v-if="!viewMode" size="small" @click="addActualSizeRow()">新增完成尺码</a-button>
            </div>
            <div class="size-grid">
              <div v-for="(item, index) in actualSizeRows" :key="item.key" class="size-grid__item">
                <a-input v-model:value="item.size" placeholder="灏虹爜" :disabled="viewMode" />
                <a-input-number v-model:value="item.qty" :min="0" style="width: 100%" :disabled="viewMode" />
                <a-button v-if="!viewMode" size="small" danger @click="removeActualSizeRow(index)">删除</a-button>
              </div>
            </div>
            <a-row :gutter="12" style="margin-top: 12px;">
              <a-col :span="8"><a-form-item label="已完成数量"><a-input :value="formatQty(actualOutputValue)" readonly /></a-form-item></a-col>
              <a-col :span="8"><a-form-item label="损耗率"><a-input :value="formatLossPercent(cutLossRateValue)" readonly /></a-form-item></a-col>
            </a-row>
          </template>

          <a-form-item label="备注" style="margin-top: 12px;"><a-textarea v-model:value="form.remark" :rows="2" :auto-size="{ minRows: 2, maxRows: 5 }" /></a-form-item>
        </a-form>

        <a-divider />

        <div class="section-caption" style="margin-bottom: 12px;">
          <div>
            <div class="section-caption__title">生产用料</div>
            <div class="section-caption__desc">单件用量为预估值；胸杯支持分码数量；保存后系统只重算当前这张生产单。</div>
          </div>
          <a-button v-if="!viewMode" @click="addMaterialRow()">新增原料</a-button>
        </div>
        <div v-for="(row, index) in materialRows" :key="row.localKey" class="bom-row">
          <div class="sortable-row__bar">
            <span class="sortable-row__title">原料 {{ index + 1 }}</span>
            <a-button v-if="!viewMode" size="small" danger @click="removeMaterialRow(index)">删除</a-button>
          </div>
          <a-row :gutter="10" class="plan-editor-row">
            <a-col :span="5">
              <a-form-item label="原料" required>
                <a-select v-model:value="row.material_id" :options="materialOptions" show-search option-filter-prop="label" @change="() => handleMaterialRowChange(row)" />
              </a-form-item>
            </a-col>
            <a-col :span="2">
              <a-form-item label="用料类型">
                <InlineOptionSelect
                  v-model="row.material_role"
                  :entries="optionLists.materialRoles"
                  option-type="material_role"
                  add-label="用料类型"
                  placeholder="用料类型"
                  @options-updated="handleOptionsUpdated"
                  @update:modelValue="() => syncUsageModeByRole(row)"
                />
              </a-form-item>
            </a-col>
            <a-col :span="3"><a-form-item label="供料方式"><a-select v-model:value="row.supply_mode" :options="supplyModeOptions" /></a-form-item></a-col>
            <a-col :span="2"><a-form-item label="计料方式"><a-select v-model:value="row.usage_mode" :options="usageModeOptions" /></a-form-item></a-col>
            <a-col :span="4"><a-form-item label="颜色"><a-select v-model:value="row.material_color" class="material-related-select" style="width: 100%" show-search option-filter-prop="label" allow-clear :options="getColorOptions(row.material_id)" placeholder="选择颜色" /></a-form-item></a-col>
            <a-col :span="2"><a-form-item label="核价口径"><a-select v-model:value="row.cost_price_type" :options="priceTypeOptions" /></a-form-item></a-col>
            <a-col :span="3"><a-form-item label="单件用量"><a-input-number v-model:value="row.usage" style="width: 100%" :min="0" :step="0.0001" /></a-form-item></a-col>
            <a-col :span="2">
              <a-form-item label="单位">
                <InlineOptionSelect
                  v-model="row.usage_unit"
                  :entries="optionLists.units"
                  option-type="unit"
                  add-label="单位"
                  placeholder="单位"
                  @options-updated="handleOptionsUpdated"
                />
              </a-form-item>
            </a-col>
          </a-row>
          <a-row :gutter="10" class="plan-editor-row plan-editor-row--secondary">
            <a-col :span="3"><a-form-item label="实际用量"><a-input-number v-model:value="row.actual_issued_qty" style="width: 100%" :min="0" :step="0.0001" :disabled="!canEditActualUsage" /></a-form-item></a-col>
            <a-col :span="2">
              <a-form-item label="用量单位">
                <InlineOptionSelect
                  v-model="row.actual_issued_unit"
                  :entries="optionLists.units"
                  option-type="unit"
                  add-label="单位"
                  placeholder="单位"
                  :disabled="!canEditActualUsage"
                  @options-updated="handleOptionsUpdated"
                />
              </a-form-item>
            </a-col>
            <a-col :span="3"><a-form-item label="实际总金额"><a-input-number v-model:value="row.actual_total_amount" style="width: 100%" :min="0" :step="0.01" :precision="2" :disabled="!canEditActualUsage" /></a-form-item></a-col>
            <a-col v-if="isFabricMaterialRow(row)" :span="2"><a-form-item label="条数"><a-input-number v-model:value="row.actual_roll_count" style="width: 100%" :min="0" :step="1" :precision="0" :disabled="!canEditActualUsage" /></a-form-item></a-col>
            <a-col :span="2"><a-form-item label="损耗率"><a-input-number v-model:value="row.loss_rate" style="width: 100%" :step="0.01" /></a-form-item></a-col>
          </a-row>
          <a-row :gutter="10" class="plan-editor-row">
            <a-col :span="10">
              <a-form-item label="处理要求">
                <a-select
                  v-model:value="row.processing_requirements"
                  mode="tags"
                  :options="processingRequirementOptions"
                  placeholder="默认预缩/对色/验布，可自定义"
                />
              </a-form-item>
            </a-col>
          </a-row>

          <template v-if="isCupMaterialRow(row)">
            <div class="section-caption section-caption--compact" style="margin: 6px 0 10px;">
              <div>
                <div class="section-caption__title">胸杯实际使用数量</div>
                <div class="section-caption__desc">支持自定义尺码，这里填写各尺码胸杯的实际使用数量，库存会按对应尺码扣减。</div>
              </div>
              <a-button v-if="!viewMode" size="small" @click="addCupSizeRow(row)">新增胸杯尺码</a-button>
            </div>
            <div class="size-grid size-grid--compact cup-size-grid">
              <div v-for="(sizeItem, sizeIndex) in row.cup_size_rows" :key="sizeItem.key" class="size-grid__item cup-size-grid__item">
                <a-select v-model:value="sizeItem.size" class="material-related-select" style="width: 100%" show-search option-filter-prop="label" allow-clear :options="getCupSizeOptions(row.material_id, sizeItem.size)" placeholder="尺码" :disabled="viewMode" />
                <a-input-number v-model:value="sizeItem.qty" :min="0" style="width: 100%" :disabled="viewMode" />
                <a-button v-if="!viewMode" size="small" danger @click="removeCupSizeRow(row, sizeIndex)">删除</a-button>
              </div>
            </div>
            <div class="inventory-size-summary">
              <div v-for="inventoryLine in getCupInventoryLines(row)" :key="inventoryLine.key" class="inventory-size-summary__line">
                <span class="inventory-size-summary__label">{{ inventoryLine.label }}</span>
                <span class="inventory-size-summary__value">{{ inventoryLine.value }}</span>
              </div>
            </div>
          </template>

          <div v-if="resolveMaterial(row.material_id)" class="bom-row-hint">
            <div>基础单位：{{ normalizeUnit(resolveMaterial(row.material_id)?.unit) }}</div>
            <div>原料成分：{{ resolveMaterial(row.material_id)?.composition || '-' }}</div>
            <div>分类：{{ resolveMaterial(row.material_id)?.category_path || '-' }}</div>
            <div>仓库剩余：{{ formatInventoryAvailabilityText(row, 'warehouse') }}</div>
            <div>工厂剩余：{{ formatInventoryAvailabilityText(row, 'factory') }}</div>
            <div v-if="isFabricMaterialRow(row)">面料条数：{{ formatQty(row.actual_roll_count || 0) }}</div>
            <div>实际单件用量：{{ formatRowActualUsagePerPiece(row) }}</div>
            <div>单件该用料成本：{{ formatMoney(getRowPerPieceCost(row), 4) }}/件</div>
            <div>总金额：{{ formatMoney(getRowTotalCost(row), 2) }}</div>
            <div v-if="isCupMaterialRow(row)">胸杯实际使用合计：{{ formatQty(sumSizeRows(row.cup_size_rows || [])) }}</div>
            <div v-if="getRowInventoryWarning(row)" class="bom-row-hint__warning">{{ getRowInventoryWarning(row) }}</div>
          </div>
        </div>
      </div>

      <div v-if="viewMode" style="margin-top: 16px;">
        <a-divider />
        <div class="section-caption__title" style="margin-bottom: 8px;">单据图片</div>
        <div v-if="reviewImages.length" class="multi-image-grid">
          <div v-for="(item, index) in reviewImages" :key="`${index}-${item.slice(0, 20)}`" class="multi-image-grid__item">
            <a-popover placement="rightTop" trigger="hover" overlay-class-name="inventory-image-popover">
              <template #content>
                <img :src="item" class="inventory-image-preview inventory-image-preview--full" alt="生产单图片预览" />
              </template>
              <img :src="item" class="multi-image-grid__preview" alt="生产单图片" @click="openImagePreview(item)" />
            </a-popover>
          </div>
        </div>
        <div v-else class="table-secondary">暂无单据图片</div>
      </div>
      <template v-if="!viewMode" #footer>
        <a-space>
          <a-button @click="visible = false">取消</a-button>
          <a-button @click="saveTempDraft">保存为临时草稿</a-button>
          <a-button type="primary" :loading="saving" @click="save">确定</a-button>
        </a-space>
      </template>
    </a-modal>

    <a-modal v-model:open="auditVisible" title="审核生产单" width="860px" @ok="confirmAudit">
      <a-form layout="vertical">
        <a-form-item label="审核单据图片" required>
          <MultiImageDropInput v-model="reviewImages" title="上传生产单 / 收货单图片" />
        </a-form-item>
      </a-form>
    </a-modal>

    <a-modal
      v-model:open="statusDialogVisible"
      :title="statusDialogTitle"
      width="920px"
      :confirm-loading="statusDialogSaving"
      :ok-button-props="{ disabled: statusDialogSaving }"
      :cancel-button-props="{ disabled: statusDialogSaving }"
      @ok="confirmStatusDialog"
    >
      <div class="section-caption" style="margin-bottom: 12px;">
        <div>
          <div class="section-caption__title">{{ statusDialogTitle }}</div>
          <div class="section-caption__desc">尺码会跟随当前制单的待生产尺码自动同步；只需补充对应数量，系统会自动汇总。</div>
        </div>
      </div>
      <a-form layout="vertical" style="margin-bottom: 12px;">
        <a-row :gutter="12">
          <a-col :span="10">
            <a-form-item :label="statusDialogDateLabel" required>
              <a-date-picker v-model:value="statusDialogDate" value-format="YYYY-MM-DD" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
      <template v-if="statusDialogNeedsQty">
      <div class="size-grid size-grid--dialog">
        <div v-for="(item, index) in statusDialogRows" :key="item.key" class="size-grid__item">
          <a-input v-model:value="item.size" placeholder="尺码" readonly />
          <a-input-number v-model:value="item.qty" :min="0" style="width: 100%" />
        </div>
      </div>
      <div class="table-secondary" style="margin-top: 12px;">合计：{{ formatQty(sumSizeRows(statusDialogRows)) }}</div>
      </template>
      <template v-if="statusDialogMaterialDisplayRows.length">
        <a-divider />
        <div class="section-caption" style="margin-bottom: 12px;">
          <div>
            <div class="section-caption__title">实际总用量</div>
            <div class="section-caption__desc">进入“生产中 / 已完成”时，可同步填写每个原料的实际总用量；若不填写或为 0，则按成衣默认用量回算。</div>
          </div>
        </div>
        <div v-for="row in statusDialogMaterialDisplayRows" :key="row.localKey" class="bom-row" style="padding: 12px 14px;">
          <a-row :gutter="10" class="plan-editor-row status-dialog-material-grid">
            <a-col :span="10">
              <a-form-item label="原料">
                <a-input :value="statusDialogMaterialLabel(row)" readonly />
              </a-form-item>
            </a-col>
            <a-col :span="5">
              <a-form-item label="实际总用量">
                <a-input-number v-model:value="row.actual_issued_qty" style="width: 100%" :min="0" :step="0.0001" />
              </a-form-item>
            </a-col>
            <a-col :span="4">
              <a-form-item label="用量单位">
                <InlineOptionSelect
                  v-model="row.actual_issued_unit"
                  :entries="optionLists.units"
                  option-type="unit"
                  add-label="单位"
                  placeholder="单位"
                  @options-updated="handleOptionsUpdated"
                />
              </a-form-item>
            </a-col>
            <a-col :span="5">
              <a-form-item label="实际总金额">
                <a-input-number v-model:value="row.actual_total_amount" style="width: 100%" :min="0" :step="0.01" :precision="2" />
              </a-form-item>
            </a-col>
            <a-col v-if="isFabricMaterialRow(row)" :span="5">
              <a-form-item label="实际条数">
                <a-input-number v-model:value="row.actual_roll_count" style="width: 100%" :min="0" :step="1" :precision="0" />
              </a-form-item>
            </a-col>
          </a-row>
          <template v-if="isCupMaterialRow(row)">
            <div class="status-dialog-cup-grid">
              <div v-for="(sizeItem, sizeIndex) in row.cup_size_rows" :key="sizeItem.key" class="status-dialog-cup-grid__item">
                <a-select v-model:value="sizeItem.size" class="material-related-select" style="width: 100%" show-search option-filter-prop="label" allow-clear :options="getCupSizeOptions(row.material_id, sizeItem.size)" placeholder="尺码" />
                <a-input-number v-model:value="sizeItem.qty" style="width: 100%" :min="0" />
                <a-button size="small" danger @click="removeCupSizeRow(row, sizeIndex)">删除</a-button>
              </div>
            </div>
          </template>
          <div class="status-dialog-material-usage-line">
            <span class="status-dialog-material-usage-line__label">实际单件用量：</span>
            <span class="status-dialog-material-usage-line__value">{{ formatStatusDialogActualUsagePerPiece(row) }}</span>
          </div>
          <div class="status-dialog-material-usage-line">
            <span class="status-dialog-material-usage-line__label">仓库/工厂剩余：</span>
            <span class="status-dialog-material-usage-line__value">{{ formatInventoryAvailabilityText(row, 'warehouse') }} / {{ formatInventoryAvailabilityText(row, 'factory') }}</span>
          </div>
          <div v-if="getRowInventoryWarning(row)" class="bom-row-hint__warning bom-row-hint__warning--dialog">{{ getRowInventoryWarning(row) }}</div>
        </div>
      </template>
    </a-modal>

    <a-modal v-model:open="previewVisible" title="图片预览" :footer="null" width="960px" centered>
      <div class="image-preview-modal">
        <img v-if="previewImage" :src="previewImage" class="image-preview-modal__img" alt="单据图片预览" />
      </div>
    </a-modal>
    </a-card>
  </div>
</template>

<script setup>
import { computed, nextTick, onActivated, onMounted, reactive, ref, watch } from 'vue'
import dayjs from 'dayjs'
import { message, Modal } from 'ant-design-vue'
import InlineOptionSelect from '@/components/InlineOptionSelect.vue'
import MobileFilterPanel from '@/components/MobileFilterPanel.vue'
import MultiImageDropInput from '@/components/MultiImageDropInput.vue'
import PageSummaryStrip from '@/components/PageSummaryStrip.vue'
import { useDebouncedInput } from '@/composables/useDebouncedInput'
import { useMobileLayout } from '@/composables/useMobileLayout'
import { api, formatMoney } from '@/utils/api'
import { convertQuantity, convertUnitPrice, normalizeUnit } from '@/utils/material'

const { inputValue: keywordInput, debouncedValue: keyword } = useDebouncedInput('', 260)
const productionViewStateStorageKey = 'production.view.state'
const { isMobileLayout } = useMobileLayout()
const factoryFilter = ref(undefined)
const statusFilter = ref(undefined)
const documentStatusFilter = ref(undefined)
const dateRange = ref([])
const lossThresholdPercent = ref(5)
const onlyWarnings = ref(false)
const batchDocumentStatus = ref(undefined)
const selectedRowKeys = ref([])
const sortField = ref('created_at')
const sortOrder = ref('desc')
const exportIncludeProcessFee = ref(false)
const listLoading = ref(false)
const saving = ref(false)
const statusDialogSaving = ref(false)
const visible = ref(false)
const viewMode = ref(false)
const auditVisible = ref(false)
const statusDialogVisible = ref(false)
const previewVisible = ref(false)
const previewImage = ref('')
const deliveryDate = ref('')
const pendingDate = ref('')
const cutDate = ref('')
const completedDate = ref('')
const PRODUCTION_DRAFT_KEY = 'garment-ems:production-temp-draft'
const baseDataLoadedAt = ref(0)
let baseDataPromise = null
let listLoadToken = 0
let listReloadTimer = null

const list = ref([])
const garments = ref([])
const materials = ref([])
const inventorySummary = ref({ materials: [], batches: [], inTransit: [], inTransitBatches: [] })
const inventoryWarehouseMap = ref(new Map())
const inventoryFactoryMap = ref(new Map())
const reviewImages = ref([])
const statusDialogRows = ref([])
const statusDialogMaterialRows = ref([])
const statusDialogTargetStatus = ref('待生产')
const statusDialogRecordId = ref(null)
const statusDialogSource = ref('form')
const statusDialogDate = ref('')
const auditTargetIds = ref([])
const sizeRows = ref([])
const cutSizeRows = ref([])
const actualSizeRows = ref([])
const materialRows = ref([])
const optionLists = ref({ factories: [], units: [], materialRoles: [] })
const isPopulatingForm = ref(false)

const form = reactive({
  id: null,
  order_no: '',
  garment_id: null,
  factory_name: '',
  process_fee: 0,
  document_status: 'draft',
  status: '待生产',
  remark: ''
})
const selectedFactoryFeeKey = ref(undefined)

watch(
  () => normalizeSizeRows(sizeRows.value),
  (rows) => {
    if (!statusDialogVisible.value || statusDialogSource.value !== 'form') return
    statusDialogRows.value = buildStatusDialogTemplateRows(rows, statusDialogRows.value)
  },
  { deep: true }
)

const documentStatusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已提交', value: 'submitted' },
  { label: '已审核', value: 'approved' },
  { label: '已作废', value: 'voided' }
]

const quickDocumentStatusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '已提交', value: 'submitted' }
]

const sortFieldOptions = [
  { label: '按创建时间', value: 'created_at' },
  { label: '按制单号', value: 'order_no' },
  { label: '按成衣编号', value: 'style_code' },
  { label: '按加工厂', value: 'factory_name' },
  { label: '按阶段成本', value: 'actual_unit_cost' }
]

const sortOrderOptions = [
  { label: '倒序', value: 'desc' },
  { label: '正序', value: 'asc' }
]

const statusFilterOptions = [
  { label: '待生产', value: '待生产' },
  { label: '生产中', value: '生产中' },
  { label: '已完成', value: '已完成' }
]

const legacyMaterialRoleOptions = [
  { label: 'A料', value: 'A料' },
  { label: 'B料', value: 'B料' },
  { label: 'C料', value: 'C料' },
  { label: '辅料', value: '辅料' },
  { label: '其他', value: '其他' }
]

const materialRoleOptions = computed(() => {
  const source = Array.isArray(optionLists.value?.materialRoles) ? optionLists.value.materialRoles : []
  const normalized = source
    .map((item) => {
      if (item && typeof item === 'object') return String(item.value || '').trim()
      return String(item || '').trim()
    })
    .filter(Boolean)
  const fallback = ['A料', 'B料', 'C料', 'D料', '里布', '辅料', '其他']
  const values = [...new Set([...(normalized.length ? normalized : fallback), ...fallback])]
  return values.map((item) => ({ label: item, value: item }))
})

const usageModeOptions = [
  { label: '尽裁', value: 'full_cut' },
  { label: '按量', value: 'by_usage' }
]

const supplyModeOptions = [
  { label: '我方提供', value: 'our_supply' },
  { label: '工厂自配', value: 'factory_supply' }
]

const priceTypeOptions = [
  { label: '大货价', value: 'bulk' },
  { label: '版布价', value: 'sample' },
  { label: '净布价', value: 'net' }
]

const processingRequirementOptions = [
  { label: '预缩', value: '预缩' },
  { label: '对色', value: '对色' },
  { label: '验布', value: '验布' }
]

const columns = [
  { title: '制单号', dataIndex: 'order_no', key: 'order_no', width: 170 },
  { title: '成衣 / 工厂', key: 'garment', width: 240 },
  { title: '数量', key: 'qty', width: 160 },
  { title: '生产状态', key: 'status', width: 180 },
  { title: '成本', key: 'cost', width: 180 },
  { title: '日期', key: 'dates', width: 150 },
  { title: '操作', key: 'action', width: 520 }
]

function formatMaterialLabel(item) {
  const code = String(item?.code || item?.material_code || '').trim()
  const name = String(item?.name || item?.material_name || '').trim()
  if (code && name) return `${code} / ${name}`
  return code || name || '-'
}

const garmentOptions = computed(() =>
  garments.value.map((item) => ({
    label: item.name ? `${item.style_code} / ${item.name}` : `${item.style_code}`,
    value: item.id
  }))
)
const selectedGarmentRecord = computed(() =>
  garments.value.find((item) => Number(item.id) === Number(form.garment_id)) || null
)
const selectedGarmentFactoryFeeOptions = computed(() =>
  (Array.isArray(selectedGarmentRecord.value?.factory_process_fees) ? selectedGarmentRecord.value.factory_process_fees : [])
    .map((item) => ({
      label: `${item.factory_name}：${formatMoney(item.process_fee, 4)} 元/件`,
      value: item.factory_name
    }))
)
const currentFactoryFeeHint = computed(() => {
  const garment = selectedGarmentRecord.value
  if (!garment) return '未选择成衣'
  const match = (Array.isArray(garment.factory_process_fees) ? garment.factory_process_fees : [])
    .find((item) => String(item.factory_name || '').trim() === String(form.factory_name || '').trim())
  if (match) return `${match.factory_name}：${formatMoney(match.process_fee, 4)} 元/件`
  if (Array.isArray(garment.factory_process_fees) && garment.factory_process_fees.length) {
    return '当前工厂未命中专属加工费，请手动输入或切换已配置工厂'
  }
  return '当前成衣未设置工厂加工费方案，可手动输入'
})

const materialOptions = computed(() =>
  materials.value.map((item) => ({
    label: formatMaterialLabel(item),
    value: item.id
  }))
)

const factoryFilterOptions = computed(() =>
  [...new Set(list.value.map((item) => String(item.factory_name || '').trim()).filter(Boolean))]
    .map((item) => ({ label: item, value: item }))
)

const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys) => {
    selectedRowKeys.value = keys
  }
}))

function resolveGarmentProcessFee(garment, factoryName = '') {
  if (!garment) return 0
  const normalizedFactoryName = String(factoryName || '').trim()
  const match = (Array.isArray(garment.factory_process_fees) ? garment.factory_process_fees : [])
    .find((item) => String(item.factory_name || '').trim() === normalizedFactoryName)
  return Number(match?.process_fee ?? garment.process_fee ?? 0)
}

function applySelectedFactoryFee(factoryName) {
  selectedFactoryFeeKey.value = factoryName || undefined
  if (factoryName) {
    form.factory_name = factoryName
  }
  form.process_fee = resolveGarmentProcessFee(selectedGarmentRecord.value, form.factory_name)
}

const quantityValue = computed(() => sumSizeRows(sizeRows.value))
const cutOutputValue = computed(() => sumSizeRows(cutSizeRows.value))
const actualOutputValue = computed(() => sumSizeRows(actualSizeRows.value))
const showProgressSection = computed(() => ['生产中', '已完成'].includes(form.status))
const showCompletedSection = computed(() => form.status === '已完成')
const statusDialogTitle = computed(() => statusDialogTargetStatus.value === '已完成' ? '填写已完成分码数量' : '填写生产中分码数量')
const statusDialogDateLabel = computed(() => {
  if (statusDialogTargetStatus.value === '待生产') return '下单日期'
  if (statusDialogTargetStatus.value === '生产中') return '裁床日期'
  return '出货日期'
})
const statusDialogNeedsQty = computed(() => ['生产中', '已完成'].includes(statusDialogTargetStatus.value))
const statusDialogMaterialDisplayRows = computed(() => statusDialogMaterialRows.value.filter((item) => Number(item?.material_id || 0) > 0))
const statusDialogStageQty = computed(() => Number(sumSizeRows(statusDialogRows.value) || 0))
const stageBaseQty = computed(() => {
  if (form.status === '已完成' && actualOutputValue.value > 0) return actualOutputValue.value
  if (form.status === '生产中' && cutOutputValue.value > 0) return cutOutputValue.value
  return quantityValue.value
})
const canEditActualUsage = computed(() => ['生产中', '已完成'].includes(form.status))
const cutLossRateValue = computed(() => {
  if (cutOutputValue.value <= 0 || actualOutputValue.value <= 0) return null
  return (cutOutputValue.value - actualOutputValue.value) / cutOutputValue.value
})

function normalizeProductionFilterText(value) {
  return String(value || '').trim()
}

function productionRecordMatchesKeyword(record, keywordText) {
  if (!keywordText) return true
  const haystack = [
    record.order_no,
    record.style_code,
    record.garment_name,
    record.factory_name,
    record.remark
  ]
    .map((item) => normalizeProductionFilterText(item).toLowerCase())
    .filter(Boolean)
    .join(' ')
  return haystack.includes(keywordText)
}

function productionRecordMatchesDate(record, from, to) {
  if (!from && !to) return true
  const dates = [
    normalizeProductionFilterText(record.pending_date),
    normalizeProductionFilterText(record.cut_date),
    normalizeProductionFilterText(record.completed_date),
    normalizeProductionFilterText(record.delivery_date),
    normalizeProductionFilterText(String(record.created_at || '').slice(0, 10))
  ].filter(Boolean)
  if (!dates.length) return false
  return dates.some((item) => {
    if (from && item < from) return false
    if (to && item > to) return false
    return true
  })
}

const filteredList = computed(() => {
  const keywordText = normalizeProductionFilterText(keyword.value).toLowerCase()
  const [dateFrom, dateTo] = Array.isArray(dateRange.value) ? dateRange.value : []
  const result = [...list.value].filter((record) => {
    if (!productionRecordMatchesKeyword(record, keywordText)) return false
    if (factoryFilter.value && normalizeProductionFilterText(record.factory_name) !== normalizeProductionFilterText(factoryFilter.value)) return false
    if (statusFilter.value && normalizeProductionFilterText(record.status) !== normalizeProductionFilterText(statusFilter.value)) return false
    if (documentStatusFilter.value && normalizeProductionFilterText(record.document_status || 'draft').toLowerCase() !== normalizeProductionFilterText(documentStatusFilter.value).toLowerCase()) return false
    if (onlyWarnings.value && !isWarning(record)) return false
    if (!productionRecordMatchesDate(record, normalizeProductionFilterText(dateFrom), normalizeProductionFilterText(dateTo))) return false
    return true
  })
  const direction = sortOrder.value === 'asc' ? 1 : -1
  result.sort((left, right) => {
    if (sortField.value === 'order_no') {
      return String(left.order_no || '').localeCompare(String(right.order_no || ''), 'zh-Hans-CN', { numeric: true }) * direction
    }
    if (sortField.value === 'style_code') {
      return String(left.style_code || '').localeCompare(String(right.style_code || ''), 'zh-Hans-CN', { numeric: true }) * direction
    }
    if (sortField.value === 'factory_name') {
      return String(left.factory_name || '').localeCompare(String(right.factory_name || ''), 'zh-Hans-CN', { numeric: true }) * direction
    }
    if (sortField.value === 'actual_unit_cost') {
      return (Number(left.actual_unit_cost || 0) - Number(right.actual_unit_cost || 0)) * direction
    }
    return String(left.created_at || '').localeCompare(String(right.created_at || ''), 'zh-Hans-CN', { numeric: true }) * direction
  })
  return result
})

const summaryItems = computed(() => {
  const warningCount = filteredList.value.filter((item) => isWarning(item)).length
  const totalQty = filteredList.value.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const inProgressQty = filteredList.value.reduce((sum, item) => sum + Number(item.cut_output_qty || 0), 0)
  const completedQty = filteredList.value.reduce((sum, item) => sum + Number(item.actual_output_qty || 0), 0)
  return [
    { label: '生产单数', value: `${filteredList.value.length} 张`, note: '按当前筛选范围统计' },
    { label: '待生产总量', value: formatQty(totalQty), note: '按待生产尺码分配汇总' },
    { label: '生产中总量', value: formatQty(inProgressQty), note: '按生产中尺码分配汇总' },
    { label: '已完成总量', value: formatQty(completedQty), note: '按已完成尺码分配汇总' },
    { label: '异常单数', value: `${warningCount} 张`, note: `损耗率高于 ${formatMoney(lossThresholdPercent.value, 1)}% 标红` }
  ]
})

function loadStoredViewState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(productionViewStateStorageKey) || '{}')
    keywordInput.value = String(parsed.keyword || '')
    factoryFilter.value = parsed.factoryFilter || undefined
    statusFilter.value = parsed.statusFilter || undefined
    documentStatusFilter.value = parsed.documentStatusFilter || undefined
    dateRange.value = Array.isArray(parsed.dateRange) ? parsed.dateRange.filter(Boolean).slice(0, 2) : []
    lossThresholdPercent.value = Number.isFinite(Number(parsed.lossThresholdPercent)) ? Number(parsed.lossThresholdPercent) : 5
    onlyWarnings.value = Boolean(parsed.onlyWarnings)
    sortField.value = ['created_at', 'order_no', 'style_code', 'factory_name', 'actual_unit_cost'].includes(parsed.sortField)
      ? parsed.sortField
      : 'created_at'
    sortOrder.value = parsed.sortOrder === 'asc' ? 'asc' : 'desc'
  } catch {}
}

function saveStoredViewState() {
  try {
    localStorage.setItem(
      productionViewStateStorageKey,
      JSON.stringify({
        keyword: keywordInput.value,
        factoryFilter: factoryFilter.value,
        statusFilter: statusFilter.value,
        documentStatusFilter: documentStatusFilter.value,
        dateRange: Array.isArray(dateRange.value) ? dateRange.value : [],
        lossThresholdPercent: lossThresholdPercent.value,
        onlyWarnings: onlyWarnings.value,
        sortField: sortField.value,
        sortOrder: sortOrder.value
      })
    )
  } catch {}
}

function normalizeInventoryText(value, fallback = '') {
  return String(value || fallback).trim()
}

function buildInventoryLookupKey(materialId, color = '', size = '', factoryName = '') {
  return [
    Number(materialId || 0),
    normalizeInventoryText(color).toLowerCase() || '*',
    normalizeInventoryText(size).toLowerCase() || '*',
    normalizeInventoryText(factoryName).toLowerCase() || '*'
  ].join('__')
}

function appendInventoryMapValue(map, key, amount) {
  if (!key) return
  map.set(key, Number(map.get(key) || 0) + Number(amount || 0))
}

function splitInventoryFactoryNames(value = '') {
  return String(value || '')
    .split(/[、,，/]/)
    .map((item) => normalizeInventoryText(item))
    .filter(Boolean)
}

function mergeInventoryFallbackMap(targetMap, fallbackMap) {
  fallbackMap.forEach((amount, key) => {
    if (!targetMap.has(key) || Math.abs(Number(targetMap.get(key) || 0)) <= 0.000001) {
      targetMap.set(key, Number(amount || 0))
    }
  })
}

function buildProductionInventoryMaps(summary = {}) {
  const nextWarehouseMap = new Map()
  const nextFactoryMap = new Map()
  const fallbackWarehouseMap = new Map()
  const fallbackFactoryMap = new Map()

  ;(summary.batches || []).forEach((batch) => {
    const materialId = Number(batch.material_id || 0)
    if (!materialId) return
    const color = normalizeInventoryText(batch.color, '未分色')
    const size = normalizeInventoryText(batch.size)
    const warehouseQty = Number(batch.warehouse_available_after_prealloc_qty ?? batch.warehouse_remaining_qty ?? 0)

    ;[...new Set([
      buildInventoryLookupKey(materialId, color, size),
      buildInventoryLookupKey(materialId, color, ''),
      buildInventoryLookupKey(materialId, '', size),
      buildInventoryLookupKey(materialId, '', '')
    ])].forEach((key) => appendInventoryMapValue(nextWarehouseMap, key, warehouseQty))

    ;(batch.allocations || []).forEach((allocation) => {
      const factoryName = normalizeInventoryText(allocation.factory_name)
      if (!factoryName) return
      const remainingQty = Number(allocation.available_after_prealloc_qty ?? allocation.remaining_qty ?? 0)
      ;[...new Set([
        buildInventoryLookupKey(materialId, color, size, ''),
        buildInventoryLookupKey(materialId, color, '', ''),
        buildInventoryLookupKey(materialId, '', size, ''),
        buildInventoryLookupKey(materialId, '', '', ''),
        buildInventoryLookupKey(materialId, color, size, factoryName),
        buildInventoryLookupKey(materialId, color, '', factoryName),
        buildInventoryLookupKey(materialId, '', size, factoryName),
        buildInventoryLookupKey(materialId, '', '', factoryName)
      ])].forEach((key) => appendInventoryMapValue(nextFactoryMap, key, remainingQty))
    })
  })

  ;(summary.materials || []).forEach((item) => {
    const materialId = Number(item.material_id || item.id || 0)
    if (!materialId) return
    const color = normalizeInventoryText(item.color, '未分色')
    const size = normalizeInventoryText(item.size)
    const warehouseQty = Number(item.warehouse_available_after_prealloc_qty ?? item.warehouse_remaining_qty ?? 0)
    const factoryQty = Number(item.factory_available_after_prealloc_qty ?? item.factory_remaining_qty ?? 0)
    const factoryNames = splitInventoryFactoryNames(item.factory_name)

    ;[...new Set([
      buildInventoryLookupKey(materialId, color, size),
      buildInventoryLookupKey(materialId, color, ''),
      buildInventoryLookupKey(materialId, '', size),
      buildInventoryLookupKey(materialId, '', '')
    ])].forEach((key) => appendInventoryMapValue(fallbackWarehouseMap, key, warehouseQty))

    ;[...new Set([
      buildInventoryLookupKey(materialId, color, size, ''),
      buildInventoryLookupKey(materialId, color, '', ''),
      buildInventoryLookupKey(materialId, '', size, ''),
      buildInventoryLookupKey(materialId, '', '', ''),
      ...factoryNames.flatMap((factoryName) => [
        buildInventoryLookupKey(materialId, color, size, factoryName),
        buildInventoryLookupKey(materialId, color, '', factoryName),
        buildInventoryLookupKey(materialId, '', size, factoryName),
        buildInventoryLookupKey(materialId, '', '', factoryName)
      ])
    ])].forEach((key) => appendInventoryMapValue(fallbackFactoryMap, key, factoryQty))
  })

  mergeInventoryFallbackMap(nextWarehouseMap, fallbackWarehouseMap)
  mergeInventoryFallbackMap(nextFactoryMap, fallbackFactoryMap)

  inventorySummary.value = summary || { materials: [], batches: [], inTransit: [], inTransitBatches: [] }
  inventoryWarehouseMap.value = nextWarehouseMap
  inventoryFactoryMap.value = nextFactoryMap
}

async function refreshProductionInventorySummary(excludeOrderId = form.id) {
  const payload = Number(excludeOrderId || 0) > 0
    ? { exclude_production_order_id: Number(excludeOrderId) }
    : {}
  const summaryResult = await api.db.getInventorySummary(payload)
  buildProductionInventoryMaps(summaryResult || {})
  return summaryResult || {}
}

watch(
  () => form.status,
  (value) => {
    if (value === '待生产') {
      cutSizeRows.value = []
      actualSizeRows.value = []
    } else if (value === '生产中') {
      actualSizeRows.value = []
      if (!cutSizeRows.value.length) cutSizeRows.value = cloneSizeRows(sizeRows.value)
    } else if (value === '已完成') {
      if (!cutSizeRows.value.length) cutSizeRows.value = cloneSizeRows(sizeRows.value)
      if (!actualSizeRows.value.length) actualSizeRows.value = cloneSizeRows(cutSizeRows.value.length ? cutSizeRows.value : sizeRows.value)
    }
  }
)

watch(
  () => [form.factory_name, form.garment_id],
  ([factoryName, garmentId]) => {
    if (!garmentId || viewMode.value || isPopulatingForm.value) return
    const garment = garments.value.find((item) => Number(item.id) === Number(garmentId))
    if (!garment) return
    selectedFactoryFeeKey.value = String(factoryName || '').trim() || undefined
    form.process_fee = resolveGarmentProcessFee(garment, factoryName)
  }
)

watch(
  () => [normalizeSizeRows(sizeRows.value), normalizeSizeRows(cutSizeRows.value), normalizeSizeRows(actualSizeRows.value)],
  () => {
    ;[materialRows.value, statusDialogMaterialRows.value].forEach((rows) => {
      ;(rows || []).forEach((row) => {
        if (!isCupMaterialRow(row)) return
        row.cup_size_rows = normalizeCupSizeRows(row.cup_size_rows || [], row.material_id)
      })
    })
  },
  { deep: true }
)

async function loadBaseData() {
  if (baseDataPromise) {
    return baseDataPromise
  }
  if (
    materials.value.length &&
    garments.value.length &&
    optionLists.value &&
    Date.now() - baseDataLoadedAt.value < 60000
  ) {
    return
  }
  baseDataPromise = Promise.all([
    api.db.getMaterials(),
    api.db.getGarments(),
    api.db.getOptionLists(),
    refreshProductionInventorySummary(form.id)
  ])
    .then(([materialsResult, garmentsResult, optionsResult]) => {
      materials.value = materialsResult || []
      garments.value = garmentsResult || []
      optionLists.value = optionsResult || { factories: [], units: [], materialRoles: [] }
      baseDataLoadedAt.value = Date.now()
    })
    .finally(() => {
      baseDataPromise = null
    })
  return baseDataPromise
}

async function loadList() {
  const loadToken = ++listLoadToken
  listLoading.value = true
  try {
    const [dateFrom, dateTo] = Array.isArray(dateRange.value) ? dateRange.value : []
    const result = await api.db.getProductionOrders({
      keyword: keyword.value,
      factory_name: factoryFilter.value,
      status: statusFilter.value,
      document_status: documentStatusFilter.value,
      date_from: dateFrom || '',
      date_to: dateTo || '',
      only_warnings: onlyWarnings.value,
      loss_threshold_percent: Number(lossThresholdPercent.value || 0),
      limit: 1000
    })
    if (loadToken !== listLoadToken) return
    list.value = result
  } finally {
    if (loadToken === listLoadToken) {
      listLoading.value = false
    }
  }
}

function scheduleListReload(delay = 100) {
  if (listReloadTimer) {
    clearTimeout(listReloadTimer)
  }
  listReloadTimer = setTimeout(() => {
    listReloadTimer = null
    loadList()
  }, delay)
}

function patchListRecord(recordId, patch = {}) {
  const targetId = Number(recordId || 0)
  if (!targetId) return
  const nextList = [...list.value]
  const index = nextList.findIndex((item) => Number(item.id) === targetId)
  if (index < 0) return
  nextList.splice(index, 1, {
    ...nextList[index],
    ...patch
  })
  list.value = nextList
}

async function refreshPage() {
  try {
    if (!materials.value.length || !garments.value.length) {
      await loadBaseData()
    }
    if (!list.value.length && !listLoading.value) {
      await loadList()
    }
    message.success('已刷新')
  } catch (error) {
    message.error(error.message || '刷新生产制单失败')
  }
}

function handleOptionsUpdated(nextLists) {
  optionLists.value = nextLists
}

function formatQty(value) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? amount.toFixed(0).replace(/\\.0+$/, '') : '0'
}

function formatLossPercent(value) {
  if (value === null || value === undefined || value === '') return '-'
  return `${(Number(value || 0) * 100).toFixed(2)}%`
}

function roundValue(value, digits = 6) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return 0
  return Number(amount.toFixed(digits))
}

function getAdjustedUnitPrice(price, material = {}) {
  const rawPrice = Number(price || 0)
  if (!rawPrice) return 0
  const adjustmentType = String(material.adjustment_type || 'none').trim()
  if (adjustmentType === 'rate') {
    const rawGapRatio = Number(material.gap_ratio || 0)
    const gapRatio = rawGapRatio > 1 ? rawGapRatio / 100 : rawGapRatio
    if (gapRatio > 0) return roundValue(rawPrice / gapRatio, 6)
  }
  if (adjustmentType === 'weight_gap') {
    const referenceQty = Number(material.gap_reference_qty || 0)
    const deduction = Math.max(Number(material.left_gap || 0), 0) + Math.max(Number(material.right_gap || 0), 0)
    const netQty = referenceQty - deduction
    if (referenceQty > 0 && netQty > 0) return roundValue(rawPrice * (referenceQty / netQty), 6)
  }
  return roundValue(rawPrice, 6)
}

function documentStatusLabel(value) {
  if (value === 'submitted') return '已提交'
  if (value === 'approved') return '已审核'
  if (value === 'voided') return '已作废'
  return '草稿'
}

function documentStatusColor(value) {
  if (value === 'approved') return 'green'
  if (value === 'voided') return 'red'
  if (value === 'submitted') return 'blue'
  return 'default'
}

function getProductionRowClassName(record) {
  return record?.document_status === 'voided' ? 'erp-row--voided' : ''
}

function isLockedDocument(value) {
  return value === 'approved' || value === 'voided'
}

function isWarning(record) {
  const lossRate = Number(record?.cut_loss_rate)
  if (!Number.isFinite(lossRate)) return false
  return lossRate > Number(lossThresholdPercent.value || 0) / 100
}

function createDefaultSizeRows() {
  return ['S', 'M', 'L'].map((size) => createSizeRow(size))
}

function createSizeRow(size = '', qty = 0) {
  return { key: `${Date.now()}-${Math.random()}`, size, qty: Number(qty || 0) }
}

function normalizeSizeRows(rows = []) {
  return (rows || [])
    .map((item) => ({ size: String(item?.size || '').trim(), qty: Number(item?.qty || 0) }))
    .filter((item) => item.size || item.qty)
}

function sumSizeRows(rows = []) {
  return normalizeSizeRows(rows).reduce((sum, item) => sum + Number(item.qty || 0), 0)
}

function stringifySizeRows(rows = []) {
  return JSON.stringify(normalizeSizeRows(rows))
}

function parseSizeRows(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
    const normalized = normalizeSizeRows(parsed)
    return normalized.length ? normalized.map((item) => createSizeRow(item.size, item.qty)) : []
  } catch {
    return []
  }
}

function cloneSizeRows(rows = []) {
  const normalized = normalizeSizeRows(rows)
  return normalized.length ? normalized.map((item) => createSizeRow(item.size, item.qty)) : createDefaultSizeRows()
}

function getProductionSizeValueList() {
  return [...new Set([
    ...normalizeSizeRows(sizeRows.value).map((item) => item.size),
    ...normalizeSizeRows(cutSizeRows.value).map((item) => item.size),
    ...normalizeSizeRows(actualSizeRows.value).map((item) => item.size)
  ].map((item) => String(item || '').trim()).filter(Boolean))]
}

function buildStatusDialogTemplateRows(baseRows = [], valueRows = []) {
  const normalizedBaseRows = normalizeSizeRows(baseRows)
  const fallbackRows = normalizedBaseRows.length ? normalizedBaseRows : normalizeSizeRows(createDefaultSizeRows())
  const valueMap = new Map(
    normalizeSizeRows(valueRows)
      .filter((item) => item.size)
      .map((item) => [String(item.size || '').trim().toLowerCase(), Number(item.qty || 0)])
  )
  return fallbackRows.map((item) => createSizeRow(item.size, valueMap.has(String(item.size || '').trim().toLowerCase()) ? valueMap.get(String(item.size || '').trim().toLowerCase()) : Number(item.qty || 0)))
}

function buildStatusDialogRows(nextStatus, sourceRecord = null) {
  if (sourceRecord) {
    const baseRows = parseSizeRows(sourceRecord.size_breakdown || '[]')
    const valueRows = nextStatus === '生产中'
      ? parseSizeRows(sourceRecord.cut_size_breakdown || sourceRecord.size_breakdown || '[]')
      : parseSizeRows(sourceRecord.actual_size_breakdown || sourceRecord.cut_size_breakdown || sourceRecord.size_breakdown || '[]')
    return buildStatusDialogTemplateRows(baseRows, valueRows)
  }
  const valueRows = nextStatus === '生产中'
    ? (cutSizeRows.value.length ? cutSizeRows.value : sizeRows.value)
    : (actualSizeRows.value.length ? actualSizeRows.value : (cutSizeRows.value.length ? cutSizeRows.value : sizeRows.value))
  return buildStatusDialogTemplateRows(sizeRows.value, valueRows)
}

function createMaterialRow(seed = {}) {
  const material = resolveMaterial(seed.material_id)
  return {
    localKey: `${Date.now()}-${Math.random()}`,
    material_id: seed.material_id || null,
    material_code: seed.material_code || material?.code || '',
    material_name: seed.material_name || material?.name || '',
    material_role: seed.material_role || '辅料',
    supply_mode: seed.supply_mode || 'our_supply',
    usage_mode: seed.usage_mode || (seed.material_role === 'A料' ? 'full_cut' : 'by_usage'),
    material_color: seed.material_color || '',
    cost_price_type: seed.cost_price_type || 'bulk',
    usage: Number(seed.usage || 0),
    usage_unit: normalizeUnit(seed.usage_unit || material?.unit || '米'),
    actual_issued_qty: Number(seed.actual_issued_qty_raw ?? seed.actual_issued_qty ?? 0),
    actual_roll_count: Number(seed.actual_roll_count || 0),
    actual_issued_unit: normalizeUnit(seed.actual_issued_unit || material?.unit || '米'),
    actual_total_amount: Number(seed.actual_total_amount || 0),
    loss_rate: Number(seed.loss_rate || 0),
    processing_requirements: Array.isArray(seed.processing_requirements) ? [...seed.processing_requirements] : [],
    cup_size_rows: normalizeCupSizeRows(seed.material_size_breakdown || seed.cup_size_rows || [], seed.material_id),
    usage_in_material_unit: Number(seed.usage_in_material_unit || 0),
    current_unit_cost: Number(seed.current_unit_cost || 0),
    current_unit_cost_per_meter: Number(seed.current_unit_cost_per_meter || 0),
    actualUsagePerPiece: Number(seed.actualUsagePerPiece || seed.actual_usage_per_piece || 0)
  }
}

function normalizeProductionDraftMaterialRow(row = {}) {
  const next = createMaterialRow(row)
  const material = resolveMaterial(next.material_id)
  if (material) {
    next.usage_unit = normalizeUnit(next.usage_unit || material.unit || '米')
    next.actual_issued_unit = normalizeUnit(next.actual_issued_unit || material.unit || '米')
  }
  return next
}

function getMaterialRowsWithSelection(sourceRows = materialRows.value) {
  return (sourceRows || []).filter((item) => item && item.material_id)
}

function validateProductionMaterialRows(sourceRows = materialRows.value) {
  const selectedRows = getMaterialRowsWithSelection(sourceRows)
  if (!selectedRows.length) {
    throw new Error('请至少填写一条生产用料')
  }
  return selectedRows
}

function resolveMaterial(materialId) {
  return materials.value.find((item) => Number(item.id) === Number(materialId)) || null
}

function getColorOptions(materialId) {
  const material = resolveMaterial(materialId)
  const profileColors = (material?.colorProfiles || []).map((item) => item?.color)
  return [...new Set([...(material?.allColors || []), ...(material?.colors || []), ...profileColors]
    .map((item) => String(item || '').trim())
    .filter(Boolean))]
    .map((item) => ({ label: item, value: item }))
}

function getCupSizeValueList(materialId) {
  const material = resolveMaterial(materialId)
  const directSizes = Array.isArray(material?.sizePrices) ? material.sizePrices.map((item) => item?.size) : []
  const profileSizes = (material?.colorProfiles || []).flatMap((profile) =>
    Array.isArray(profile?.sizePrices) ? profile.sizePrices.map((item) => item?.size) : []
  )
  return [...new Set([...(material?.allSizes || []), ...directSizes, ...profileSizes, ...getProductionSizeValueList(), 'S', 'M', 'L'])]
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

function normalizeCupSizeRows(rows = [], materialId = null) {
  const normalized = normalizeSizeRows(Array.isArray(rows) ? rows : [])
  if (normalized.length) return normalized.map((item) => createSizeRow(item.size, item.qty))
  return getCupSizeValueList(materialId).map((item) => createSizeRow(item))
}

function getCupSizeOptions(materialId, current) {
  return [...new Set([...getCupSizeValueList(materialId), String(current || '').trim()].filter(Boolean))]
    .map((item) => ({ label: item, value: item }))
}

function isCupMaterial(material) {
  return [
    material?.major_category,
    material?.category,
    material?.sub_category,
    material?.leaf_category,
    material?.category_path,
    material?.name
  ].some((item) => String(item || '').includes('胸杯'))
}

function isFabricMaterial(material) {
  return String(material?.major_category || '').trim() === '面料'
}

function isCupMaterialRow(row) {
  return isCupMaterial(resolveMaterial(row.material_id))
}

function isFabricMaterialRow(row) {
  return isFabricMaterial(resolveMaterial(row.material_id))
}

function syncUsageModeByRole(row) {
  if (row.material_role === 'A料') row.usage_mode = 'full_cut'
}

function handleMaterialRowChange(row) {
  const material = resolveMaterial(row.material_id)
  if (!material) return
  row.usage_unit = normalizeUnit(row.usage_unit || material.unit || '米')
  row.actual_issued_unit = normalizeUnit(row.actual_issued_unit || material.unit || '米')
  if (!isFabricMaterial(material)) row.actual_roll_count = 0
  if (!row.material_color) {
    const firstColor = getColorOptions(row.material_id)[0]?.value
    row.material_color = firstColor || material.primaryColor || ''
  }
  if (isCupMaterial(material) && !normalizeSizeRows(row.cup_size_rows).length) {
    row.cup_size_rows = normalizeCupSizeRows([], row.material_id)
  }
}

function resolveMaterialColorProfile(material, color) {
  const profiles = Array.isArray(material?.colorProfiles) ? material.colorProfiles : []
  const target = String(color || '').trim().toLowerCase()
  if (!profiles.length) return null
  return profiles.find((item) => String(item?.color || '').trim().toLowerCase() === target) || profiles[0] || null
}

function resolveUnitPriceBySource(price, sourceUnit, targetUnit, material) {
  const amount = Number(price || 0)
  if (!amount) return 0
  try {
    return Number(convertUnitPrice(amount, sourceUnit || targetUnit, targetUnit, material) || 0)
  } catch {
    return 0
  }
}

function resolveProfileUnitCost(profile, priceType, targetUnit, material, preferredUnit = targetUnit) {
  if (!profile) return 0
  const normalizedTargetUnit = normalizeUnit(targetUnit || material?.unit || '米')
  const normalizedPreferredUnit = normalizeUnit(preferredUnit || normalizedTargetUnit)
  if (priceType === 'sample') {
    const samplePreferredPrice = normalizedPreferredUnit === '公斤'
      ? profile.sample_price_kg
      : normalizedPreferredUnit === '码'
        ? profile.sample_price_yard
        : profile.sample_price_meter
    return resolveUnitPriceBySource(getAdjustedUnitPrice(samplePreferredPrice, material), normalizedPreferredUnit, normalizedTargetUnit, material)
      || resolveUnitPriceBySource(getAdjustedUnitPrice(profile.sample_price_kg, material), '公斤', normalizedTargetUnit, material)
      || resolveUnitPriceBySource(getAdjustedUnitPrice(profile.sample_price_meter, material), '米', normalizedTargetUnit, material)
      || resolveUnitPriceBySource(getAdjustedUnitPrice(profile.sample_price_yard, material), '码', normalizedTargetUnit, material)
  }
  if (priceType === 'net') {
    return resolveUnitPriceBySource(getAdjustedUnitPrice(profile.net_price_meter, material), '米', normalizedTargetUnit, material)
  }
  const bulkPreferredPrice = normalizedPreferredUnit === '公斤'
    ? profile.bulk_price_kg
    : normalizedPreferredUnit === '码'
      ? profile.bulk_price_yard
      : profile.bulk_price_meter
  return resolveUnitPriceBySource(getAdjustedUnitPrice(bulkPreferredPrice, material), normalizedPreferredUnit, normalizedTargetUnit, material)
    || resolveUnitPriceBySource(getAdjustedUnitPrice(profile.bulk_price_kg, material), '公斤', normalizedTargetUnit, material)
    || resolveUnitPriceBySource(getAdjustedUnitPrice(profile.bulk_price_meter, material), '米', normalizedTargetUnit, material)
    || resolveUnitPriceBySource(getAdjustedUnitPrice(profile.bulk_price_yard, material), '码', normalizedTargetUnit, material)
    || resolveUnitPriceBySource(getAdjustedUnitPrice(profile.default_price, material), profile.default_price_unit || normalizedTargetUnit, normalizedTargetUnit, material)
}

function resolveCupUnitCost(profile, row, targetUnit, material, preferredUnit = targetUnit) {
  if (!profile) return 0
  const sizeRows = normalizeSizeRows(row.cup_size_rows || [])
  const activeRows = sizeRows.filter((item) => item.size && Number(item.qty || 0) > 0)
  const sizePrices = Array.isArray(profile.sizePrices) ? profile.sizePrices : []
  const resolveSizePrice = (size) => {
    const entry = sizePrices.find((item) => String(item?.size || '').trim().toLowerCase() === String(size || '').trim().toLowerCase())
    if (!entry) return 0
    return resolveUnitPriceBySource(entry.price, entry.unit || profile.default_price_unit || targetUnit, targetUnit, material)
  }

  if (activeRows.length) {
    const totalQty = activeRows.reduce((sum, item) => sum + Number(item.qty || 0), 0)
    const totalCost = activeRows.reduce((sum, item) => sum + (Number(item.qty || 0) * resolveSizePrice(item.size)), 0)
    if (totalQty > 0 && totalCost > 0) return totalCost / totalQty
  }

  const firstSize = sizeRows.find((item) => item.size)?.size || ''
  return resolveSizePrice(firstSize) || resolveProfileUnitCost(profile, row.cost_price_type || 'bulk', targetUnit, material, preferredUnit)
}

function getRowMaterialUnit(row) {
  return normalizeUnit(resolveMaterial(row.material_id)?.unit || row.material_unit || row.usage_unit || '米')
}

function getRowResolvedUnitCost(row) {
  const material = resolveMaterial(row.material_id)
  if (!material) return Number(row.current_unit_cost || 0)
  const materialUnit = getRowMaterialUnit(row)
  const pricingUnit = normalizeUnit(row.usage_unit || materialUnit)
  const profile = resolveMaterialColorProfile(material, row.material_color)
  let unitCost = 0
  if (isCupMaterialRow(row)) {
    unitCost = resolveCupUnitCost(profile, row, materialUnit, material, pricingUnit)
  } else {
    unitCost = resolveProfileUnitCost(profile, row.cost_price_type || 'bulk', materialUnit, material, pricingUnit)
  }
  if (unitCost > 0) return Number(unitCost)
  return resolveUnitPriceBySource(getAdjustedUnitPrice(material.default_price, material), material.default_price_unit || material.unit || materialUnit, materialUnit, material)
    || Number(row.current_unit_cost || 0)
}

function getRowUsageInMaterialUnit(row) {
  const material = resolveMaterial(row.material_id)
  const materialUnit = getRowMaterialUnit(row)
  try {
    return Number(convertQuantity(Number(row.usage || 0), normalizeUnit(row.usage_unit || materialUnit), materialUnit, material || {}) || 0)
  } catch {
    return Number(row.usage_in_material_unit || row.usage || 0)
  }
}

function getRowFallbackUsedInMaterialUnit(row) {
  return roundValue(Number(getRowUsageInMaterialUnit(row) || 0) * Number(stageBaseQty.value || 0), 6)
}

function getAdjustedActualQty(row, material, sourceQty, sourceUnit) {
  const actualQty = Number(sourceQty || 0)
  if (actualQty <= 0) return 0
  return actualQty
}

function getRowCalculatedUsedInMaterialUnit(row) {
  const actualQty = Number(getRowActualUsedInMaterialUnit(row) || 0)
  if (actualQty > 0) return actualQty
  return Number(getRowFallbackUsedInMaterialUnit(row) || 0)
}

function getRowActualTotalAmount(row) {
  return Number(row.actual_total_amount || 0)
}

function getRowActualUsagePerPiece(row) {
  const stageQty = Number(stageBaseQty.value || 0)
  const actualQty = getRowActualUsedInMaterialUnit(row)
  if (stageQty > 0 && actualQty > 0) return actualQty / stageQty
  const fallbackQty = getRowFallbackUsedInMaterialUnit(row)
  if (stageQty > 0 && fallbackQty > 0) return fallbackQty / stageQty
  return Number(row.actualUsagePerPiece || row.actual_usage_per_piece || 0)
}

function formatRowActualUsagePerPiece(row) {
  const value = Number(getRowActualUsagePerPiece(row) || 0)
  if (value <= 0) return '-'
  return `${formatQty(value)} ${getRowMaterialUnit(row)}`
}

function formatStatusDialogActualUsagePerPiece(row) {
  const stageQty = Number(statusDialogStageQty.value || 0)
  const actualQty = getRowActualUsedInMaterialUnit(row)
  if (stageQty > 0 && actualQty > 0) {
    return `${formatQty(actualQty / stageQty)} ${getRowMaterialUnit(row)}`
  }
  return formatRowActualUsagePerPiece(row)
}

function getRowActualUsedInMaterialUnit(row) {
  const material = resolveMaterial(row.material_id)
  const materialUnit = getRowMaterialUnit(row)
  const actualQty = Number(row.actual_issued_qty || 0)
  if (actualQty <= 0 && isCupMaterialRow(row)) {
    return Number(sumSizeRows(row.cup_size_rows || []) || 0)
  }
  if (actualQty <= 0) return 0
  const sourceUnit = normalizeUnit(row.actual_issued_unit || materialUnit)
  try {
    return Number(convertQuantity(actualQty, sourceUnit, materialUnit, material || {}) || 0)
  } catch {
    return actualQty
  }
}

function getRowCostQtyInMaterialUnit(row) {
  const material = resolveMaterial(row.material_id)
  const materialUnit = getRowMaterialUnit(row)
  const actualQty = Number(row.actual_issued_qty || 0)
  if (actualQty <= 0 && isCupMaterialRow(row)) {
    const cupQty = Number(sumSizeRows(row.cup_size_rows || []) || 0)
    return cupQty > 0 ? cupQty : Number(getRowFallbackUsedInMaterialUnit(row) || 0)
  }
  if (actualQty <= 0) return Number(getRowFallbackUsedInMaterialUnit(row) || 0)
  const sourceUnit = normalizeUnit(row.actual_issued_unit || materialUnit)
  const costQty = getAdjustedActualQty(row, material, actualQty, sourceUnit)
  try {
    return Number(convertQuantity(costQty, sourceUnit, materialUnit, material || {}) || 0)
  } catch {
    return costQty
  }
}

function getRowPerPieceCost(row) {
  const stageQty = Number(stageBaseQty.value || 0)
  const actualTotalAmount = getRowActualTotalAmount(row)
  if (stageQty > 0 && actualTotalAmount > 0) {
    return actualTotalAmount / stageQty
  }
  const unitCost = Number(getRowResolvedUnitCost(row) || 0)
  const costQty = getRowCostQtyInMaterialUnit(row)
  if (stageQty > 0 && costQty > 0) {
    return (costQty / stageQty) * unitCost
  }
  const estimatedUsage = getRowUsageInMaterialUnit(row) * (1 + Number(row.loss_rate || 0))
  return estimatedUsage * unitCost
}

function getRowTotalCost(row) {
  const actualTotalAmount = getRowActualTotalAmount(row)
  if (actualTotalAmount > 0) return actualTotalAmount
  const unitCost = Number(getRowResolvedUnitCost(row) || 0)
  const costQty = getRowCostQtyInMaterialUnit(row)
  if (costQty > 0) return costQty * unitCost
  return getRowPerPieceCost(row) * Number(stageBaseQty.value || 0)
}

function formatInventoryQty(value, unit) {
  const amount = Number(value || 0)
  if (!Number.isFinite(amount)) return `0${unit}`
  return `${amount.toFixed(4).replace(/0+$/, '').replace(/\.$/, '') || '0'}${unit}`
}

function getRowInventoryBalance(row, mode = 'warehouse', size = '', factoryName = form.factory_name) {
  const materialId = Number(row?.material_id || 0)
  if (!materialId) return 0
  const color = normalizeInventoryText(row?.material_color, '未分色')
  const normalizedSize = normalizeInventoryText(size)
  if (mode === 'factory') {
    const normalizedFactoryName = normalizeInventoryText(factoryName)
    if (!normalizedFactoryName) {
      return Number(
        inventoryFactoryMap.value.get(buildInventoryLookupKey(materialId, color, normalizedSize, ''))
        || inventoryFactoryMap.value.get(buildInventoryLookupKey(materialId, '', normalizedSize, ''))
        || inventoryFactoryMap.value.get(buildInventoryLookupKey(materialId, color, '', ''))
        || inventoryFactoryMap.value.get(buildInventoryLookupKey(materialId, '', '', ''))
        || 0
      )
    }
    return Number(
      inventoryFactoryMap.value.get(buildInventoryLookupKey(materialId, color, normalizedSize, normalizedFactoryName))
      || inventoryFactoryMap.value.get(buildInventoryLookupKey(materialId, '', normalizedSize, normalizedFactoryName))
      || inventoryFactoryMap.value.get(buildInventoryLookupKey(materialId, color, '', normalizedFactoryName))
      || inventoryFactoryMap.value.get(buildInventoryLookupKey(materialId, '', '', normalizedFactoryName))
      || 0
    )
  }
  return Number(
    inventoryWarehouseMap.value.get(buildInventoryLookupKey(materialId, color, normalizedSize))
    || inventoryWarehouseMap.value.get(buildInventoryLookupKey(materialId, '', normalizedSize))
    || inventoryWarehouseMap.value.get(buildInventoryLookupKey(materialId, color, ''))
    || inventoryWarehouseMap.value.get(buildInventoryLookupKey(materialId, '', ''))
    || 0
  )
}

function formatInventoryAvailabilityText(row, mode = 'warehouse', size = '', factoryName = form.factory_name) {
  const amount = getRowInventoryBalance(row, mode, size, factoryName)
  return formatInventoryQty(amount, getRowMaterialUnit(row))
}

function getRowExpectedUsageInMaterialUnit(row, size = '') {
  if (isCupMaterialRow(row) && size) {
    const sizeRow = normalizeSizeRows(row.cup_size_rows || []).find((item) => item.size === size)
    const actualSizeQty = Number(sizeRow?.qty || 0)
    return actualSizeQty > 0 ? actualSizeQty : 0
  }
  const actualQty = Number(getRowActualUsedInMaterialUnit(row) || 0)
  if (actualQty > 0) return actualQty
  return Number(getRowFallbackUsedInMaterialUnit(row) || 0)
}

function getRowInventoryWarning(row, factoryName = form.factory_name) {
  if (!row?.material_id || row.supply_mode === 'factory_supply') return ''
  const unit = getRowMaterialUnit(row)
  const hasFactorySelected = Boolean(normalizeInventoryText(factoryName))
  if (isCupMaterialRow(row)) {
    const lines = getCupInventoryLines(row, factoryName)
      .filter((item) => item.warning)
      .map((item) => item.warning)
    return lines[0] || ''
  }
  const needQty = getRowExpectedUsageInMaterialUnit(row)
  if (needQty <= 0) return ''
  const factoryRemaining = getRowInventoryBalance(row, 'factory', '', factoryName)
  const warehouseRemaining = getRowInventoryBalance(row, 'warehouse', '', factoryName)
  if (factoryRemaining >= needQty) return ''
  if (factoryRemaining + warehouseRemaining < needQty) {
    return `该原料库存不足，${hasFactorySelected ? '工厂' : '工厂合计'}剩余 ${formatInventoryQty(factoryRemaining, unit)}，仓库剩余 ${formatInventoryQty(warehouseRemaining, unit)}，还差 ${formatInventoryQty(needQty - factoryRemaining - warehouseRemaining, unit)}`
  }
  return `${hasFactorySelected ? '工厂剩余量不足' : '当前未选择工厂，已按全部工厂剩余量显示'}，仓库剩余：${formatInventoryQty(warehouseRemaining, unit)}`
}

function getCupInventoryLines(row, factoryName = form.factory_name) {
  if (!isCupMaterialRow(row)) return []
  const hasFactorySelected = Boolean(normalizeInventoryText(factoryName))
  return getCupSizeValueList(row.material_id).map((size) => {
    const warehouseRemaining = getRowInventoryBalance(row, 'warehouse', size, factoryName)
    const factoryRemaining = getRowInventoryBalance(row, 'factory', size, factoryName)
    const needQty = getRowExpectedUsageInMaterialUnit(row, size)
    let warning = ''
    if (needQty > 0 && row.supply_mode !== 'factory_supply') {
      if (factoryRemaining < needQty && factoryRemaining + warehouseRemaining < needQty) {
        warning = `尺码 ${size} 库存不足，${hasFactorySelected ? '工厂' : '工厂合计'}剩余 ${formatInventoryQty(factoryRemaining, getRowMaterialUnit(row))}，仓库剩余 ${formatInventoryQty(warehouseRemaining, getRowMaterialUnit(row))}，还差 ${formatInventoryQty(needQty - factoryRemaining - warehouseRemaining, getRowMaterialUnit(row))}`
      } else if (factoryRemaining < needQty) {
        warning = `尺码 ${size} ${hasFactorySelected ? '工厂剩余量不足' : '当前未选择工厂，已按全部工厂剩余量显示'}，仓库剩余：${formatInventoryQty(warehouseRemaining, getRowMaterialUnit(row))}`
      }
    }
    return {
      key: `${row.localKey}-${size}`,
      label: `${size} 码`,
      value: `工厂 ${formatInventoryQty(factoryRemaining, getRowMaterialUnit(row))} / 仓库 ${formatInventoryQty(warehouseRemaining, getRowMaterialUnit(row))}`,
      warning
    }
  })
}

function buildInventoryValidationErrors(rows = [], factoryName = form.factory_name) {
  return (rows || [])
    .filter((row) => Number(row?.material_id || 0) > 0)
    .map((row) => getRowInventoryWarning(row, factoryName))
    .filter(Boolean)
}

function addSizeRow() { sizeRows.value.push(createSizeRow()) }
function removeSizeRow(index) { sizeRows.value.splice(index, 1) }
function addCutSizeRow() { cutSizeRows.value.push(createSizeRow()) }
function removeCutSizeRow(index) { cutSizeRows.value.splice(index, 1) }
function addActualSizeRow() { actualSizeRows.value.push(createSizeRow()) }
function removeActualSizeRow(index) { actualSizeRows.value.splice(index, 1) }
function addMaterialRow(seed = {}) { materialRows.value.push(createMaterialRow(seed)) }
function removeMaterialRow(index) { materialRows.value.splice(index, 1) }
function addCupSizeRow(row) { row.cup_size_rows.push(createSizeRow()) }
function removeCupSizeRow(row, index) { row.cup_size_rows.splice(index, 1) }

function resetForm() {
  form.id = null
  form.order_no = ''
  form.garment_id = null
  form.factory_name = ''
  form.process_fee = 0
  selectedFactoryFeeKey.value = undefined
  form.document_status = 'draft'
  form.status = '待生产'
  form.remark = ''
  deliveryDate.value = ''
  pendingDate.value = dayjs().format('YYYY-MM-DD')
  cutDate.value = ''
  completedDate.value = ''
  reviewImages.value = []
  sizeRows.value = createDefaultSizeRows()
  cutSizeRows.value = []
  actualSizeRows.value = []
  materialRows.value = []
  statusDialogMaterialRows.value = []
}

function buildProductionDraftPayload() {
  return {
    savedAt: Date.now(),
    mode: form.id ? 'edit' : 'create',
    form: {
      id: form.id,
      order_no: form.order_no,
      garment_id: form.garment_id,
      factory_name: form.factory_name,
      process_fee: Number(form.process_fee || 0),
      document_status: form.document_status,
      status: form.status,
      remark: form.remark
    },
    deliveryDate: deliveryDate.value || '',
    pendingDate: pendingDate.value || '',
    cutDate: cutDate.value || '',
    completedDate: completedDate.value || '',
    sizeRows: normalizeSizeRows(sizeRows.value),
    cutSizeRows: normalizeSizeRows(cutSizeRows.value),
    actualSizeRows: normalizeSizeRows(actualSizeRows.value),
    materialRows: materialRows.value.map((row) => ({
      material_id: row.material_id,
      material_role: row.material_role,
      supply_mode: row.supply_mode,
      usage_mode: row.usage_mode,
      material_color: row.material_color,
      cost_price_type: row.cost_price_type,
      usage: Number(row.usage || 0),
      usage_unit: row.usage_unit || '',
      actual_issued_qty: Number(row.actual_issued_qty || 0),
      actual_roll_count: Number(row.actual_roll_count || 0),
      actual_issued_unit: row.actual_issued_unit || '',
      actual_total_amount: Number(row.actual_total_amount || 0),
      loss_rate: Number(row.loss_rate || 0),
      processing_requirements: [...(row.processing_requirements || [])],
      cup_size_rows: normalizeSizeRows(row.cup_size_rows || [])
    }))
  }
}

function buildStatusDialogMaterialRows(rows = materialRows.value) {
  return (rows || []).map((row) => createMaterialRow(row))
}

function statusDialogMaterialLabel(row) {
  const material = resolveMaterial(row.material_id)
  const code = String(material?.code || row.material_code || '').trim()
  const name = String(material?.name || row.material_name || '').trim()
  const color = String(row.material_color || '').trim()
  return [code || name || '未命名原料', color].filter(Boolean).join(' / ')
}

function serializeProductionMaterialRow(row, index = 0) {
  return {
    material_id: row.material_id,
    sort_order: index + 1,
    usage: Number(row.usage || 0),
    usage_in_material_unit: Number(getRowUsageInMaterialUnit(row) || 0),
    usage_unit: normalizeUnit(row.usage_unit || resolveMaterial(row.material_id)?.unit || '米'),
    loss_rate: Number(row.loss_rate || 0),
    material_role: row.material_role || '辅料',
    supply_mode: row.supply_mode || 'our_supply',
    processing_requirements: [...(row.processing_requirements || [])],
    material_color: row.material_color || '',
    usage_mode: row.usage_mode || 'by_usage',
    material_size_breakdown: normalizeSizeRows(row.cup_size_rows || []),
    actual_issued_qty_raw: Number(row.actual_issued_qty || 0),
    actual_roll_count: Number(row.actual_roll_count || 0),
    actual_issued_unit: normalizeUnit(row.actual_issued_unit || resolveMaterial(row.material_id)?.unit || '米'),
    actual_total_amount: Number(row.actual_total_amount || 0),
    cost_price_type: row.cost_price_type || 'bulk',
    current_unit_cost: Number(getRowResolvedUnitCost(row) || row.current_unit_cost || 0),
    current_unit_cost_per_meter: Number(resolveUnitPriceBySource(getRowResolvedUnitCost(row), getRowMaterialUnit(row), '米', resolveMaterial(row.material_id)) || row.current_unit_cost_per_meter || 0)
  }
}

function getProductionTempDraft() {
  try {
    const raw = window.localStorage.getItem(PRODUCTION_DRAFT_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function clearProductionTempDraft() {
  window.localStorage.removeItem(PRODUCTION_DRAFT_KEY)
}

function applyProductionTempDraft(draft) {
  resetForm()
  form.id = draft?.form?.id || null
  form.order_no = draft?.form?.order_no || ''
  form.garment_id = draft?.form?.garment_id || null
  form.factory_name = draft?.form?.factory_name || ''
  form.process_fee = Number(draft?.form?.process_fee || 0)
  form.document_status = draft?.form?.document_status || 'draft'
  form.status = draft?.form?.status || '待生产'
  form.remark = draft?.form?.remark || ''
  deliveryDate.value = draft?.deliveryDate || ''
  pendingDate.value = draft?.pendingDate || dayjs().format('YYYY-MM-DD')
  cutDate.value = draft?.cutDate || ''
  completedDate.value = draft?.completedDate || ''
  sizeRows.value = parseSizeRows(draft?.sizeRows || [])
  if (!sizeRows.value.length) sizeRows.value = createDefaultSizeRows()
  cutSizeRows.value = parseSizeRows(draft?.cutSizeRows || [])
  actualSizeRows.value = parseSizeRows(draft?.actualSizeRows || [])
  materialRows.value = Array.isArray(draft?.materialRows)
    ? draft.materialRows.map((item) => normalizeProductionDraftMaterialRow(item))
    : []
  viewMode.value = false
  visible.value = true
  refreshProductionInventorySummary(form.id).catch(() => {})
}

function promptRestoreProductionDraft() {
  const draft = getProductionTempDraft()
  if (!draft) {
    visible.value = true
    return
  }
  Modal.confirm({
    title: '检测到临时草稿',
    content: '当前模块已有一张临时草稿，是否恢复继续填写？',
    okText: '恢复草稿',
    cancelText: '新建空白',
    onOk: () => applyProductionTempDraft(draft),
    onCancel: () => {
      visible.value = true
    }
  })
}

function saveTempDraft() {
  const nextDraft = buildProductionDraftPayload()
  const existing = getProductionTempDraft()
  const writeDraft = () => {
    window.localStorage.setItem(PRODUCTION_DRAFT_KEY, JSON.stringify(nextDraft))
    message.success('生产制单临时草稿已保存')
  }
  if (existing) {
    Modal.confirm({
      title: '已存在临时草稿',
      content: '保存新的临时草稿会覆盖上一张草稿，是否继续？',
      okText: '覆盖保存',
      cancelText: '取消',
      onOk: writeDraft
    })
    return
  }
  writeDraft()
}

async function openCreate() {
  resetForm()
  viewMode.value = false
  form.order_no = await api.db.getNextProductionOrderNo()
  await refreshProductionInventorySummary()
  promptRestoreProductionDraft()
}

async function openEdit(record) {
  const detail = await api.db.getProductionOrderDetail(record.id)
  populateForm(detail, false)
  await refreshProductionInventorySummary(detail?.id)
  promptRestoreProductionDraft()
}

async function openDetail(record) {
  const detail = await api.db.getProductionOrderDetail(record.id)
  populateForm(detail, true)
  await refreshProductionInventorySummary(detail?.id)
}

async function openCopy(record) {
  const detail = await api.db.getProductionOrderDetail(record.id)
  populateForm(detail, false)
  form.id = null
  form.order_no = await api.db.getNextProductionOrderNo()
  form.document_status = 'draft'
  reviewImages.value = []
  await refreshProductionInventorySummary()
  visible.value = true
  message.success('已复制生产单内容，可修改后另存')
}

function populateForm(detail, isViewMode) {
  isPopulatingForm.value = true
  resetForm()
  form.id = detail.id
  form.order_no = detail.order_no || ''
  form.garment_id = detail.garment_id || null
  form.factory_name = detail.factory_name || ''
  form.process_fee = Number(detail.process_fee || 0)
  selectedFactoryFeeKey.value = form.factory_name || undefined
  form.document_status = detail.document_status || 'draft'
  form.status = detail.status || '待生产'
  form.remark = detail.remark || ''
  deliveryDate.value = detail.delivery_date || ''
  pendingDate.value = detail.pending_date || String(detail.created_at || '').slice(0, 10) || dayjs().format('YYYY-MM-DD')
  cutDate.value = detail.cut_date || ''
  completedDate.value = detail.completed_date || ''
  reviewImages.value = Array.isArray(detail.review_images) ? [...detail.review_images] : []
  sizeRows.value = parseSizeRows(detail.size_breakdown)
  if (!sizeRows.value.length) sizeRows.value = createDefaultSizeRows()
  cutSizeRows.value = parseSizeRows(detail.cut_size_breakdown)
  actualSizeRows.value = parseSizeRows(detail.actual_size_breakdown)
  materialRows.value = (detail.planItems || []).map((item) => createMaterialRow(item))
  viewMode.value = isViewMode
  isPopulatingForm.value = false
  if (isViewMode) visible.value = true
}

async function handleGarmentChange(nextGarmentId) {
  if (!nextGarmentId || viewMode.value) return
  const rows = await api.db.getBomsByGarment(nextGarmentId)
  materialRows.value = (rows || []).map((item) => createMaterialRow(item))
  const garment = garments.value.find((item) => Number(item.id) === Number(nextGarmentId))
  form.process_fee = resolveGarmentProcessFee(garment, form.factory_name)
  selectedFactoryFeeKey.value = String(form.factory_name || '').trim() || undefined
  if (!String(form.remark || '').trim()) {
    form.remark = String(garment?.remark || '').trim()
  }
}

function handleFormStatusChange(value) {
  if (!value || viewMode.value) return
  statusDialogSource.value = 'form'
  statusDialogRecordId.value = null
  statusDialogTargetStatus.value = value
  statusDialogRows.value = buildStatusDialogRows(value)
  statusDialogMaterialRows.value = ['生产中', '已完成'].includes(value) ? buildStatusDialogMaterialRows(materialRows.value) : []
  statusDialogDate.value = value === '待生产'
    ? (pendingDate.value || dayjs().format('YYYY-MM-DD'))
    : value === '生产中'
      ? (cutDate.value || dayjs().format('YYYY-MM-DD'))
      : (completedDate.value || dayjs().format('YYYY-MM-DD'))
  statusDialogVisible.value = true
}

async function confirmStatusDialog() {
  const rows = cloneSizeRows(statusDialogRows.value)
  const totalQty = sumSizeRows(rows)
  if (!String(statusDialogDate.value || '').trim()) {
    message.error(`请先填写${statusDialogDateLabel.value}`)
    return
  }
  if (statusDialogNeedsQty.value && totalQty <= 0) {
    message.error('请先填写对应状态的分码数量')
    return
  }
  if (statusDialogSource.value === 'quick' && statusDialogRecordId.value) {
    statusDialogVisible.value = false
    await nextTick()
    statusDialogSaving.value = true
    try {
      const payload = { id: statusDialogRecordId.value, status: statusDialogTargetStatus.value }
      if (statusDialogTargetStatus.value === '待生产') {
        payload.pending_date = statusDialogDate.value
        payload.cut_output_qty = null
        payload.cut_size_breakdown = '[]'
        payload.actual_output_qty = null
        payload.actual_size_breakdown = '[]'
      } else if (statusDialogTargetStatus.value === '生产中') {
        payload.cut_size_breakdown = stringifySizeRows(rows)
        payload.cut_output_qty = totalQty
        payload.cut_date = statusDialogDate.value
      } else {
        payload.actual_size_breakdown = stringifySizeRows(rows)
        payload.actual_output_qty = totalQty
        payload.completed_date = statusDialogDate.value
      }
      payload.materials = statusDialogMaterialDisplayRows.value.map((row, index) => serializeProductionMaterialRow(row, index))
      const saved = await api.db.updateProductionOrderStatus(payload)
      patchListRecord(statusDialogRecordId.value, {
        status: saved?.status || payload.status,
        document_status: saved?.document_status,
        pending_date: Object.prototype.hasOwnProperty.call(payload, 'pending_date') ? payload.pending_date : undefined,
        cut_date: Object.prototype.hasOwnProperty.call(payload, 'cut_date') ? payload.cut_date : undefined,
        completed_date: Object.prototype.hasOwnProperty.call(payload, 'completed_date') ? payload.completed_date : undefined,
        cut_output_qty: Object.prototype.hasOwnProperty.call(payload, 'cut_output_qty') ? payload.cut_output_qty : undefined,
        actual_output_qty: Object.prototype.hasOwnProperty.call(payload, 'actual_output_qty') ? payload.actual_output_qty : undefined,
        material_cost: saved?.material_cost,
        process_cost: saved?.process_cost,
        total_cost: saved?.total_cost,
        unit_cost: saved?.unit_cost,
        actual_unit_cost: saved?.actual_unit_cost
      })
      message.success('生产状态已更新')
      scheduleListReload(120)
      return
    } catch (error) {
      statusDialogVisible.value = true
      message.error(error.message || '更新失败')
      return
    } finally {
      statusDialogSaving.value = false
    }
  }

  form.status = statusDialogTargetStatus.value
  if (statusDialogTargetStatus.value === '待生产') {
    pendingDate.value = statusDialogDate.value
    cutSizeRows.value = []
    actualSizeRows.value = []
  } else if (statusDialogTargetStatus.value === '生产中') {
    cutDate.value = statusDialogDate.value
    cutSizeRows.value = rows
    actualSizeRows.value = []
  } else {
    completedDate.value = statusDialogDate.value
    actualSizeRows.value = rows
  }
  materialRows.value = statusDialogMaterialRows.value.map((row) => normalizeProductionDraftMaterialRow(row))
  statusDialogMaterialRows.value = []
  statusDialogVisible.value = false
}

async function save() {
  try {
    if (!form.order_no.trim()) throw new Error('请填写制单号')
    if (!form.garment_id) throw new Error('请选择成衣')
    if (quantityValue.value <= 0) throw new Error('请填写待生产尺码分配')
    const selectedMaterialRows = validateProductionMaterialRows(materialRows.value)

    const payload = {
      id: form.id,
      order_no: form.order_no.trim(),
      garment_id: Number(form.garment_id),
      factory_name: String(form.factory_name || '').trim(),
      process_fee: Number(form.process_fee || 0),
      document_status: form.document_status,
      status: form.status,
      pending_date: pendingDate.value || '',
      cut_date: cutDate.value || '',
      completed_date: completedDate.value || '',
      delivery_date: deliveryDate.value || '',
      remark: form.remark || '',
      quantity: quantityValue.value,
      size_breakdown: stringifySizeRows(sizeRows.value),
      cut_output_qty: showProgressSection.value ? cutOutputValue.value : null,
      cut_size_breakdown: showProgressSection.value ? stringifySizeRows(cutSizeRows.value) : '[]',
      actual_output_qty: showCompletedSection.value ? actualOutputValue.value : null,
      actual_size_breakdown: showCompletedSection.value ? stringifySizeRows(actualSizeRows.value) : '[]',
      materials: selectedMaterialRows.map((row, index) => serializeProductionMaterialRow(row, index))
    }

    saving.value = true
    const saved = await api.db.saveProductionOrder(JSON.parse(JSON.stringify(payload)))
    if (saved?.id) {
      const nextList = [...list.value]
      const currentIndex = nextList.findIndex((item) => Number(item.id) === Number(saved.id))
      if (currentIndex >= 0) nextList.splice(currentIndex, 1, saved)
      else nextList.unshift(saved)
      list.value = nextList
    }
    message.success(form.id ? '生产单已更新' : '生产单已保存')
    clearProductionTempDraft()
    visible.value = false
    scheduleListReload(600)
  } catch (error) {
    message.error(error.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function handleQuickStatus(record, value) {
  if (!value) return
  try {
    const detail = await api.db.getProductionOrderDetail(record.id)
    statusDialogSource.value = 'quick'
    statusDialogRecordId.value = record.id
    statusDialogTargetStatus.value = value
    statusDialogRows.value = buildStatusDialogRows(value, detail || record)
    statusDialogMaterialRows.value = ['生产中', '已完成'].includes(value) ? buildStatusDialogMaterialRows(detail?.planItems || []) : []
    statusDialogDate.value = value === '待生产'
      ? (detail?.pending_date || String(detail?.created_at || '').slice(0, 10) || dayjs().format('YYYY-MM-DD'))
      : value === '生产中'
        ? (detail?.cut_date || dayjs().format('YYYY-MM-DD'))
        : (detail?.completed_date || dayjs().format('YYYY-MM-DD'))
    statusDialogVisible.value = true
  } catch (error) {
    message.error(error.message || '读取生产单详情失败')
  }
}

async function applyBatchDocumentStatus() {
  try {
    await api.db.batchUpdateProductionOrderDocumentStatus({ ids: [...selectedRowKeys.value], document_status: batchDocumentStatus.value })
    message.success('批量改单据状态完成')
    batchDocumentStatus.value = undefined
    scheduleListReload(600)
  } catch (error) {
    message.error(error.message || '批量修改失败')
  }
}

async function updateSingleDocumentStatus(record, value) {
  if (!value) return
  try {
    await api.db.batchUpdateProductionOrderDocumentStatus({ ids: [record.id], document_status: value })
    message.success('单据状态已更新')
    scheduleListReload(600)
  } catch (error) {
    message.error(error.message || '修改失败')
  }
}

async function openAuditModal(record) {
  try {
    const detail = await api.db.getProductionOrderDetail(record.id)
    reviewImages.value = Array.isArray(detail.review_images) ? [...detail.review_images] : []
    auditTargetIds.value = [record.id]
    auditVisible.value = true
  } catch (error) {
    message.error(error.message || '读取生产单详情失败')
  }
}

async function confirmAudit() {
  try {
    if (!reviewImages.value.length) throw new Error('请先上传生产单图片')
    await api.db.approveProductionOrders({ ids: [...auditTargetIds.value], review_images_json: [...reviewImages.value] })
    auditVisible.value = false
    message.success('审核完成')
    scheduleListReload(600)
  } catch (error) {
    message.error(error.message || '审核失败')
  }
}

async function handleBatchAudit() {
  try {
    await api.db.approveProductionOrders({ ids: [...selectedRowKeys.value] })
    message.success('批量审核完成')
    scheduleListReload(600)
  } catch (error) {
    message.error(error.message || '批量审核失败')
  }
}

async function returnProductionToDraft(ids = selectedRowKeys.value) {
  const targetIds = [...ids].filter(Boolean)
  if (!targetIds.length) return
  Modal.confirm({
    title: '确认将所选生产单退回草稿？',
    content: '退回后可继续修改尺码分配、生产状态和用料明细。',
    okText: '确认退回',
    cancelText: '取消',
    onOk: async () => {
      try {
        await api.db.returnProductionOrdersToDraft({ ids: targetIds })
        message.success('已退回草稿')
        scheduleListReload(600)
      } catch (error) {
        message.error(error.message || '退回草稿失败')
      }
    }
  })
}

async function voidProductionOrders(ids = selectedRowKeys.value) {
  try {
    await api.db.voidProductionOrders({ ids: [...ids] })
    message.success('已作废')
    scheduleListReload(600)
  } catch (error) {
    message.error(error.message || '作废失败')
  }
}

async function remove(id) {
  try {
    await api.db.deleteProductionOrder(id)
    message.success('删除成功')
    loadList()
  } catch (error) {
    message.error(error.message || '删除失败')
  }
}

function handleBatchDelete() {
  Modal.confirm({
    title: '确认批量删除所选生产单？',
    okText: '删除',
    cancelText: '取消',
    onOk: async () => {
      try {
        await Promise.all([...selectedRowKeys.value].map((id) => api.db.deleteProductionOrder(id)))
        message.success('批量删除完成')
        selectedRowKeys.value = []
        scheduleListReload(600)
      } catch (error) {
        message.error(error.message || '批量删除失败')
      }
    }
  })
}

async function handleExport(record, key) {
  const payload = {
    id: record.id,
    options: {
      include_process_fee: exportIncludeProcessFee.value
    }
  }
  try {
    if (key === 'excel') {
      await api.order.exportExcel(payload)
    } else if (key === 'image') {
      await api.order.exportImage(payload)
    } else {
      await api.order.exportPdf(payload)
    }
    message.success('导出完成')
  } catch (error) {
    message.error(error.message || '导出失败')
  }
}

async function handleBatchExport(key) {
  if (!selectedRowKeys.value.length) return
  try {
    const result = await api.order.batchExportProductionOrders({
      ids: [...selectedRowKeys.value],
      format: key,
      options: {
        include_process_fee: exportIncludeProcessFee.value
      }
    })
    if (result?.count) {
      message.success(`已批量导出 ${result.count} 张生产制单`)
    }
  } catch (error) {
    message.error(error.message || '批量导出失败')
  }
}

function openImagePreview(src) {
  previewImage.value = src
  previewVisible.value = true
}

onMounted(async () => {
  try {
    loadStoredViewState()
    await Promise.all([loadBaseData(), loadList()])
  } catch (error) {
    message.error(error.message || '页面初始化失败')
  }
})

onActivated(async () => {
  try {
    await Promise.all([loadBaseData(), loadList()])
  } catch (error) {
    message.error(error.message || '刷新生产制单失败')
  }
})
watch([keyword, factoryFilter, statusFilter, documentStatusFilter, dateRange, lossThresholdPercent, onlyWarnings], () => {
  scheduleListReload(80)
})

watch([keywordInput, factoryFilter, statusFilter, documentStatusFilter, dateRange, lossThresholdPercent, onlyWarnings, sortField, sortOrder], () => {
  saveStoredViewState()
}, { deep: true })
</script>

<style scoped>
.detail-top-panel {
  margin-bottom: 14px;
  padding: 14px 16px;
  border: 1px solid #e7edf7;
  border-radius: 14px;
  background: linear-gradient(180deg, #f8fbff 0%, #fdfefe 100%);
}

.detail-top-panel__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.detail-top-panel__item {
  min-width: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.92);
  border: 1px solid #edf2fb;
}

.detail-top-panel__label {
  margin-bottom: 4px;
  font-size: 12px;
  line-height: 18px;
  color: #7b8aa3;
}

.detail-top-panel__value {
  font-size: 14px;
  line-height: 22px;
  font-weight: 600;
  color: #1d2b46;
  word-break: break-all;
}

.cup-size-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 10px;
}

.cup-size-grid__item {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(140px, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.cup-size-grid :deep(.ant-input),
.cup-size-grid :deep(.ant-input-number),
.cup-size-grid :deep(.ant-input-number-input-wrap),
.cup-size-grid :deep(.ant-select),
.cup-size-grid :deep(.ant-select-selector),
.cup-size-grid :deep(.ant-select-auto-complete),
.status-dialog-cup-grid :deep(.ant-select),
.status-dialog-cup-grid :deep(.ant-select-selector),
.status-dialog-cup-grid :deep(.ant-input-number) {
  width: 100%;
}

.plan-editor-row :deep(.material-related-select),
.plan-editor-row :deep(.material-related-select .ant-select-selector),
.cup-size-grid :deep(.material-related-select),
.cup-size-grid :deep(.material-related-select .ant-select-selector),
.status-dialog-cup-grid :deep(.material-related-select),
.status-dialog-cup-grid :deep(.material-related-select .ant-select-selector) {
  width: 100% !important;
  min-width: 96px !important;
  min-height: 34px !important;
}

.plan-editor-row :deep(.material-related-select .ant-select-selector),
.cup-size-grid :deep(.material-related-select .ant-select-selector),
.status-dialog-cup-grid :deep(.material-related-select .ant-select-selector) {
  display: flex !important;
  align-items: center;
  border: 1px solid rgba(125, 146, 176, 0.28) !important;
  background: #fff !important;
}

.inventory-size-summary {
  display: grid;
  gap: 6px;
  margin: 4px 0 10px;
}

.inventory-size-summary__line {
  display: flex;
  gap: 10px;
  color: #5f6f8f;
  font-size: 13px;
  line-height: 1.5;
}

.inventory-size-summary__label {
  min-width: 52px;
  font-weight: 600;
}

.bom-row-hint__warning {
  color: #cf1322;
  font-weight: 600;
}

.bom-row-hint__warning--dialog {
  margin-top: 6px;
}

.status-dialog-cup-grid {
  display: grid;
  gap: 10px;
  margin-top: 8px;
}

.status-dialog-cup-grid__item {
  display: grid;
  grid-template-columns: minmax(160px, 220px) minmax(140px, 1fr) auto;
  gap: 10px;
  align-items: center;
}

.status-dialog-material-grid :deep(.ant-form-item-label > label) {
  white-space: normal;
  line-height: 1.25;
}

.status-dialog-material-usage-line {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 2px;
  padding: 2px 6px 4px;
  color: #5f6f8f;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-word;
}

.status-dialog-material-usage-line__label {
  flex: 0 0 auto;
  white-space: nowrap;
}

.status-dialog-material-usage-line__value {
  flex: 1 1 auto;
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}

@media (max-width: 1200px) {
  .detail-top-panel__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cup-size-grid__item {
    grid-template-columns: 1fr 1fr auto;
  }

  .status-dialog-cup-grid__item {
    grid-template-columns: 1fr 1fr auto;
  }

  .status-dialog-material-grid > .ant-col {
    flex: 0 0 50%;
    max-width: 50%;
  }
}
</style>


